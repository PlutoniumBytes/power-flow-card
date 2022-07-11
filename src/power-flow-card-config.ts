import { LovelaceCardConfig } from "custom-card-helpers";
import { PowerIO } from "./type.js";

export interface PowerFlowCardConfig extends LovelaceCardConfig {
  entities: {
    battery?: string;
    battery_charge?: string;
    grid: string | string[];
    solar?: string | string[];
  };
  dashboard_link?: string;
  inverted_entities: string | string[];
  kw_decimals: number;
  min_flow_rate: number;
  max_flow_rate: number;
  w_decimals: number;
  watt_threshold: number;
}
