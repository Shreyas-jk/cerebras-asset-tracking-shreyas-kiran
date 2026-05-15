import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api-client";
import type { Asset, Location } from "@/lib/types";

type DeployRequestBody = {
  asset_tag: string;
  location: Location;
  user_id: string;
  scan_payload: string;
};

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function rackLocationString(loc: Location): string {
  return [loc.site, loc.room, loc.row, loc.rack, loc.ru]
    .filter((v): v is string => Boolean(v && v.length > 0))
    .join("/");
}

function errorResponse(err: unknown, fallbackStatus = 500): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "upstream_unreachable",
        message: err instanceof Error ? err.message : "Unknown error",
      },
    },
    { status: fallbackStatus },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: DeployRequestBody;
  try {
    body = (await req.json()) as DeployRequestBody;
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_payload", message: "Body must be JSON" } },
      { status: 400 },
    );
  }

  // Defensive backstop. The client validates first; the upstream validates
  // last. This middle check keeps a bad client honest without an extra
  // round-trip.
  const loc = body.location;
  const missing: string[] = [];
  if (!loc?.site) missing.push("site");
  if (!loc?.room) missing.push("room");
  if (!loc?.rack) missing.push("rack");
  if (!loc?.ru) missing.push("ru");
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "incomplete_deploy_location",
          message: `Deploy requires site, room, rack, and ru. Missing: ${missing.join(", ")}.`,
          details: { missing },
        },
      },
      { status: 422 },
    );
  }

  // The upstream is the authority for whether the from-state allows deploy.
  // No defensive pre-fetch here — both write-backs fire unconditionally on a
  // successful scan, so the route doesn't need from_state.
  let asset: Asset;
  try {
    asset = await api.scans.deploy(body);
  } catch (err) {
    return errorResponse(err);
  }

  // Facilities + finance are independent. Fan out in parallel; report each
  // outcome separately so the UI can name what failed.
  const [facResult, finResult] = await Promise.allSettled([
    api.mock.updateFacilities({
      tagged_id: body.asset_tag,
      rack_location: rackLocationString(loc),
    }),
    api.mock.updateFinance({
      tag: body.asset_tag,
      status: "capitalized",
      site: loc.site,
      capitalized_on: todayYMD(),
    }),
  ]);

  const response: Record<string, unknown> = {
    asset,
    facilities: facResult.status === "fulfilled" ? "set" : "failed",
    finance: finResult.status === "fulfilled" ? "capitalized" : "failed",
  };

  if (facResult.status === "rejected") {
    const err = facResult.reason as unknown;
    response.facilities_error =
      err instanceof ApiError
        ? { code: err.code, message: err.message, status: err.status }
        : {
            code: "upstream_unreachable",
            message: err instanceof Error ? err.message : "Unknown",
          };
  }
  if (finResult.status === "rejected") {
    const err = finResult.reason as unknown;
    response.finance_error =
      err instanceof ApiError
        ? { code: err.code, message: err.message, status: err.status }
        : {
            code: "upstream_unreachable",
            message: err instanceof Error ? err.message : "Unknown",
          };
  }

  return NextResponse.json(response);
}
