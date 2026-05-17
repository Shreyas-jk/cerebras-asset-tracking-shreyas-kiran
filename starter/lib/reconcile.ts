import type { AssetState, FinanceRecord, Location } from "./types.js";

export type ReconcileCategory =
  | "real_drift"
  | "state_scope_drift"
  | "ghost_in_facilities"
  | "ghost_in_finance"
  | "stale_observation"
  | "ambiguous"
  | "expected_mismatch";

export type TriageLevel = "action_required" | "investigate" | "monitor";

export type ReconcileFinding =
  | {
      category: "real_drift";
      triage_level: "investigate";
      asset_tag: string;
      summary: string;
      details: {
        ops_location: string;
        facilities_location: string;
      };
    }
  | {
      category: "state_scope_drift";
      triage_level: "action_required";
      asset_tag: string;
      summary: string;
      details: {
        ops_state: AssetState;
        facilities_present: boolean;
        finance_status: FinanceRecord["status"] | null;
      };
    }
  | {
      category: "ghost_in_facilities";
      triage_level: "action_required";
      asset_tag: string;
      summary: string;
      details: {
        facilities_location: string;
        facilities_last_observed: string;
      };
    }
  | {
      category: "ghost_in_finance";
      triage_level: "action_required";
      asset_tag: string;
      summary: string;
      details: {
        finance_status: FinanceRecord["status"];
        finance_site: string;
        book_value_usd: number;
      };
    }
  | {
      category: "stale_observation";
      triage_level: "monitor";
      asset_tag: string;
      summary: string;
      details: {
        facilities_last_observed: string;
        days_since_observed: number;
        threshold_days: number;
      };
    }
  | {
      category: "ambiguous";
      triage_level: "investigate";
      asset_tag: string;
      summary: string;
      details: {
        ops_state: AssetState;
        finance_status: FinanceRecord["status"];
      };
    };

export type CountsByCategory = Record<ReconcileCategory, number>;

export type ReconcileReport = {
  generated_at: string;
  total_assets: number;
  suppressed_count: number;
  counts_by_category: CountsByCategory;
  findings: ReconcileFinding[];
};

export const STALE_DAYS = 90;

export const TRIAGE_LEVEL_BY_CATEGORY: Record<
  Exclude<ReconcileCategory, "expected_mismatch">,
  TriageLevel
> = {
  real_drift: "investigate",
  state_scope_drift: "action_required",
  ghost_in_facilities: "action_required",
  ghost_in_finance: "action_required",
  stale_observation: "monitor",
  ambiguous: "investigate",
};

export function locationToSlashString(loc: Location): string {
  return [loc.site, loc.room, loc.row, loc.rack, loc.ru]
    .filter((v): v is string => Boolean(v && v.length > 0))
    .join("/");
}
