import { NextRequest, NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api-client";
import type { Asset, Location } from "@/lib/types";

type StoreRequestBody = {
  asset_tag: string;
  location: Location;
  user_id: string;
  scan_payload: string;
};

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
  let body: StoreRequestBody;
  try {
    body = (await req.json()) as StoreRequestBody;
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_payload", message: "Body must be JSON" } },
      { status: 400 },
    );
  }

  // Pre-fetch the asset to learn from_state. We need this to decide whether
  // the de-rack write-back to facilities should fire (only when transitioning
  // out of in_service). A race is possible between this fetch and the scan,
  // but the upstream's state machine will reject any invalid transition and
  // we surface that to the tech directly.
  let fromState: Asset["state"];
  try {
    const existing = await api.assets.get(body.asset_tag);
    fromState = existing.state;
  } catch (err) {
    return errorResponse(err);
  }

  // Submit the scan. The upstream is the authority for whether the transition
  // is allowed.
  let updatedAsset: Asset;
  try {
    updatedAsset = await api.scans.store(body);
  } catch (err) {
    return errorResponse(err);
  }

  // De-rack write-back only applies when the asset was in_service before this
  // scan. From received → stored, facilities never had a row to remove.
  if (fromState !== "in_service") {
    return NextResponse.json({ asset: updatedAsset, facilities: "skipped" });
  }

  try {
    await api.mock.updateFacilities({
      tagged_id: body.asset_tag,
      rack_location: null,
    });
    return NextResponse.json({ asset: updatedAsset, facilities: "cleared" });
  } catch (err) {
    const facilitiesError =
      err instanceof ApiError
        ? { code: err.code, message: err.message, status: err.status }
        : { code: "upstream_unreachable", message: err instanceof Error ? err.message : "Unknown" };
    // Operations is now correct. Facilities is stale. The reconcile report
    // exists precisely to surface this kind of partial drift — we return 200
    // so the client can render a partial-success banner rather than treating
    // the whole operation as failed.
    return NextResponse.json({
      asset: updatedAsset,
      facilities: "failed",
      facilities_error: facilitiesError,
    });
  }
}
