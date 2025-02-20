/* eslint-disable no-nested-ternary */
import {
  mdiArrowDown,
  mdiArrowLeft,
  mdiArrowRight,
  mdiArrowUp,
  mdiBattery,
  mdiBatteryHigh,
  mdiBatteryLow,
  mdiBatteryMedium,
  mdiBatteryOutline,
  mdiHome,
  mdiSolarPower,
  mdiTransmissionTower,
} from "@mdi/js";
import { formatNumber, HomeAssistant } from "custom-card-helpers";
import { css, html, LitElement, svg, TemplateResult } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { PowerFlowCardConfig } from "./power-flow-card-config.js";
import {
  coerceNumber,
  coerceStringArray,
  round,
  isNumberValue,
} from "./utils.js";
import { PowerIO } from "./type.js";
import { logError } from "./logging.js";

const CIRCLE_CIRCUMFERENCE = 238.76104;
const KW_DECIMALS = 1;
const MAX_FLOW_RATE = 6;
const MIN_FLOW_RATE = 0.75;
const W_DECIMALS = 1;

@customElement("power-flow-card")
export class PowerFlowCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config?: PowerFlowCardConfig;

  @query("#battery-grid-flow") batteryGridFlow?: SVGSVGElement;
  @query("#battery-home-flow") batteryToHomeFlow?: SVGSVGElement;
  @query("#grid-home-flow") gridToHomeFlow?: SVGSVGElement;
  @query("#solar-battery-flow") solarToBatteryFlow?: SVGSVGElement;
  @query("#solar-grid-flow") solarToGridFlow?: SVGSVGElement;
  @query("#solar-home-flow") solarToHomeFlow?: SVGSVGElement;

  setConfig(config: PowerFlowCardConfig): void {
    if (
      !config.entities ||
      (!config.entities.battery &&
        !config.entities.grid &&
        !config.entities.solar)
    ) {
      throw new Error(
        "At least one entity for battery, grid or solar must be defined"
      );
    }
    this._config = {
      ...config,
      inverted_entities: coerceStringArray(config.inverted_entities, ","),
      kw_decimals: coerceNumber(config.kw_decimals, KW_DECIMALS),
      min_flow_rate: coerceNumber(config.min_flow_rate, MIN_FLOW_RATE),
      max_flow_rate: coerceNumber(config.max_flow_rate, MAX_FLOW_RATE),
      w_decimals: coerceNumber(config.w_decimals, W_DECIMALS),
      watt_threshold: coerceNumber(config.watt_threshold,1000),
    };
  }

  public getCardSize(): Promise<number> | number {
    return 3;
  }
  private unavailableOrMisconfiguredError = (entityId: string | undefined) =>
    logError(
      `entity "${entityId ?? "Unknown"}" is not available or misconfigured`
    );

  private entityAvailable = (entityId: string): boolean =>
    isNumberValue(this.hass.states[entityId]?.state);

  private entityInverted = (entity: string) =>
    this._config!.inverted_entities.includes(entity);

  private previousDur: { [name: string]: number } = {};

  private circleRate = (value: number, total: number): number => {
    const min = this._config?.min_flow_rate!;
    const max = this._config?.max_flow_rate!;
    return max - (value / total) * (max - min);
  };

  private getEntityState = (entity: string | undefined): number => {
    if (!entity || !this.entityAvailable(entity)) {
      this.unavailableOrMisconfiguredError(entity);
      return 0;
    }
    return coerceNumber(this.hass.states[entity].state);
  };

  private getEntities = (entities: string | string[] | undefined): string[] => {
    if (!entities ) {
      return [];
    }
    return typeof entities === "string" ? [entities] : entities;
  }

  private getEntityStateWatts = (entities: string | string[] | undefined): number => {    
    var ret:number = 0.0;
    var arr:string[] = this.getEntities( entities );
    arr.forEach( (entity) => {
      if ( this.entityAvailable(entity) ){
        const stateObj = this.hass.states[entity];
        const value = coerceNumber(stateObj.state);
        const factor = ( (stateObj.attributes.unit_of_measurement === "W") ? 1 : 1000 ) * ( this.entityInverted(entity) ? -1.0 : 1.0 );
        ret += value * factor;
      } else {
        console.log( entity + " not available ");
      }
    } );
    return ret;
  };
  
  private getEntityWatts = (entities: string | string[] | undefined): PowerIO => {
    var ret:PowerIO = { in: 0.0, out:0.0 };
    var arr:string[] = this.getEntities( entities );
    arr.forEach( (entity) => {
      if ( this.entityAvailable(entity) ){
        const stateObj = this.hass.states[entity];
        const value = coerceNumber(stateObj.state);
        const factor = ((stateObj.attributes.unit_of_measurement === "W") ? 1 : 1000 ) * ( this.entityInverted(entity) ? -1.0 : 1.0 );
        const power = value * factor;
        if ( power > 0 ){
           ret.in += power;
        } else {
           ret.out -= power;
        }
      } else {
        console.log( entity + " not available ");
      }
    } );
    return ret;
  };

  private displayValue = (value: number | null) => {
    if (value === null) return 0;
    return value >= this._config!.watt_threshold
      ? `${round(value / 1000, this._config!.kw_decimals)} kW`
      : `${round(value, this._config!.w_decimals)} W`;
  };

  protected render(): TemplateResult {
    if (!this._config || !this.hass) {
      return html``;
    }

    const { entities } = this._config;

    const hasGrid = entities.grid !== undefined;
    const hasBattery = entities.battery !== undefined;
    const hasSolarProduction = entities.solar !== undefined;
    const hasReturnToGrid = hasGrid && hasSolarProduction;

    let totalBatteryIn: number | null = this.getEntityWatts(entities.battery).in;
    let totalBatteryOut: number | null = this.getEntityWatts(entities.battery).out;
    let solarConsumption: number | null = null;
    
    const gridPower = this.getEntityWatts( entities.grid );
    const totalFromGrid = hasGrid ? gridPower.in : null;
    const returnedToGrid = hasGrid ? gridPower.out : null;
    
    let totalSolarProduction: number = 0;
    if (hasSolarProduction) {
        totalSolarProduction = this.getEntityWatts(entities.solar).in;
        solarConsumption = totalSolarProduction - (returnedToGrid ?? 0) - (totalBatteryIn ?? 0);
    }

    let batteryFromGrid: null | number = null;
    let batteryToGrid: null | number = null;
    if (solarConsumption !== null && solarConsumption < 0) {
      // What we returned to the grid and what went in to the battery is more
      // than produced, so we have used grid energy to fill the battery or
      // returned battery energy to the grid
      if (hasBattery) {
        batteryFromGrid = Math.abs(solarConsumption);
        if (batteryFromGrid > (totalFromGrid ?? 0 )) {
          batteryToGrid = Math.min(batteryFromGrid - ( totalFromGrid ?? 0 ), 0);
          batteryFromGrid = totalFromGrid;
        }
      }
      solarConsumption = 0;
    }

    let solarToBattery: null | number = null;
    if (hasSolarProduction && hasBattery) {
      if (!batteryToGrid) {
        batteryToGrid = Math.max(
          0,
          (returnedToGrid || 0) -
            (totalSolarProduction || 0) -
            (totalBatteryIn || 0) -
            (batteryFromGrid || 0)
        );
      }
      solarToBattery = totalBatteryIn! - (batteryFromGrid || 0);
    } else if (!hasSolarProduction && hasBattery) {
      batteryToGrid = returnedToGrid;
    }

    let solarToGrid = 0;
    if (hasSolarProduction && returnedToGrid)
      solarToGrid = returnedToGrid - (batteryToGrid ?? 0);

    let batteryConsumption: number | null = null;
    if (hasBattery) {
      batteryConsumption = (totalBatteryOut ?? 0) - (batteryToGrid ?? 0);
    }

    const gridConsumption = Math.max((totalFromGrid ?? 0 ) - (batteryFromGrid ?? 0), 0);

    const totalHomeConsumption = Math.max(
      gridConsumption + (solarConsumption ?? 0) + (batteryConsumption ?? 0),
      0
    );

    let homeBatteryCircumference: number | undefined;
    if (batteryConsumption)
      homeBatteryCircumference =
        CIRCLE_CIRCUMFERENCE * (batteryConsumption / totalHomeConsumption);

    let homeSolarCircumference: number | undefined;
    if (hasSolarProduction) {
      homeSolarCircumference =
        CIRCLE_CIRCUMFERENCE * (solarConsumption! / totalHomeConsumption);
    }

    const homeGridCircumference =
      CIRCLE_CIRCUMFERENCE *
      ((totalHomeConsumption -
        (batteryConsumption ?? 0) -
        (solarConsumption ?? 0)) /
        totalHomeConsumption);

    const totalLines =
      gridConsumption +
      (solarConsumption ?? 0) +
      solarToGrid +
      (solarToBattery ?? 0) +
      (batteryConsumption ?? 0) +
      (batteryFromGrid ?? 0) +
      (batteryToGrid ?? 0);

    const batteryChargeState = entities.battery_charge?.length
      ? this.getEntityState(entities.battery_charge)
      : null;

    let batteryIcon = mdiBatteryHigh;
    if (batteryChargeState === null) {
      batteryIcon = mdiBattery;
    } else if (batteryChargeState <= 72 && batteryChargeState > 44) {
      batteryIcon = mdiBatteryMedium;
    } else if (batteryChargeState <= 44 && batteryChargeState > 16) {
      batteryIcon = mdiBatteryLow;
    } else if (batteryChargeState <= 16) {
      batteryIcon = mdiBatteryOutline;
    }

    const newDur = {
      batteryGrid: this.circleRate(
        batteryFromGrid ?? batteryToGrid ?? 0,
        totalLines
      ),
      batteryToHome: this.circleRate(batteryConsumption ?? 0, totalLines),
      gridToHome: this.circleRate(gridConsumption, totalLines),
      solarToBattery: this.circleRate(solarToBattery ?? 0, totalLines),
      solarToGrid: this.circleRate(solarToGrid, totalLines),
      solarToHome: this.circleRate(solarConsumption ?? 0, totalLines),
    };

    // Smooth duration changes
    [
      "batteryGrid",
      "batteryToHome",
      "gridToHome",
      "solarToBattery",
      "solarToGrid",
      "solarToHome",
    ].forEach((flowName) => {
      const flowSVGElement = this[`${flowName}Flow`] as SVGSVGElement;
      if (
        flowSVGElement &&
        this.previousDur[flowName] &&
        this.previousDur[flowName] !== newDur[flowName]
      ) {
        flowSVGElement.pauseAnimations();
        flowSVGElement.setCurrentTime(
          flowSVGElement.getCurrentTime() *
            (newDur[flowName] / this.previousDur[flowName])
        );
        flowSVGElement.unpauseAnimations();
      }
      this.previousDur[flowName] = newDur[flowName];
    });

    return html`
      <ha-card .header=${this._config.title}>
        <div class="card-content">
          ${hasSolarProduction
            ? html` <div class="row">
                <div class="spacer"></div>
                <div class="circle-container solar">
                  <span class="label"
                    >${this.hass.localize(
                      "ui.panel.lovelace.cards.energy.energy_distribution.solar"
                    )}</span
                  >
                  <div class="circle">
                    <ha-svg-icon .path=${mdiSolarPower}></ha-svg-icon>
                    <span class="solar">
                      ${this.displayValue(totalSolarProduction)}</span
                    >
                  </div>
                </div>
                <div class="spacer"></div>
              </div>`
            : html``}
          <div class="row">
            ${hasGrid
              ? html` <div class="circle-container grid">
                  <div class="circle">
                    <ha-svg-icon .path=${mdiTransmissionTower}></ha-svg-icon>
                    ${returnedToGrid !== null
                      ? html`<span class="return">
                          <ha-svg-icon
                            class="small"
                            .path=${mdiArrowLeft}
                          ></ha-svg-icon
                          >${this.displayValue(returnedToGrid)}
                        </span>`
                      : null}
                    <span class="consumption">
                      <ha-svg-icon
                        class="small"
                        .path=${mdiArrowRight}
                      ></ha-svg-icon
                      >${this.displayValue(totalFromGrid)}
                    </span>
                  </div>
                  <span class="label"
                    >${this.hass.localize(
                      "ui.panel.lovelace.cards.energy.energy_distribution.grid"
                    )}</span
                  >
                </div>`
              : html`<div class="spacer"></div>`}
            <div class="circle-container home">
              <div class="circle">
                <ha-svg-icon .path=${mdiHome}></ha-svg-icon>
                ${this.displayValue(totalHomeConsumption)}
                <svg>
                  ${homeSolarCircumference !== undefined
                    ? svg`<circle
                            class="solar"
                            cx="40"
                            cy="40"
                            r="38"
                            stroke-dasharray="${homeSolarCircumference} ${
                        CIRCLE_CIRCUMFERENCE - homeSolarCircumference
                      }"
                            shape-rendering="geometricPrecision"
                            stroke-dashoffset="-${
                              CIRCLE_CIRCUMFERENCE - homeSolarCircumference
                            }"
                          />`
                    : ""}
                  ${homeBatteryCircumference
                    ? svg`<circle
                            class="battery"
                            cx="40"
                            cy="40"
                            r="38"
                            stroke-dasharray="${homeBatteryCircumference} ${
                        CIRCLE_CIRCUMFERENCE - homeBatteryCircumference
                      }"
                            stroke-dashoffset="-${
                              CIRCLE_CIRCUMFERENCE -
                              homeBatteryCircumference -
                              (homeSolarCircumference || 0)
                            }"
                            shape-rendering="geometricPrecision"
                          />`
                    : ""}
                  <circle
                    class="grid"
                    cx="40"
                    cy="40"
                    r="38"
                    stroke-dasharray="${homeGridCircumference ??
                    CIRCLE_CIRCUMFERENCE -
                      homeSolarCircumference! -
                      (homeBatteryCircumference ||
                        0)} ${homeGridCircumference !== undefined
                      ? CIRCLE_CIRCUMFERENCE - homeGridCircumference
                      : homeSolarCircumference! +
                        (homeBatteryCircumference || 0)}"
                    stroke-dashoffset="0"
                    shape-rendering="geometricPrecision"
                  />
                </svg>
              </div>
              <span class="label"
                >${this.hass.localize(
                  "ui.panel.lovelace.cards.energy.energy_distribution.home"
                )}</span
              >
            </div>
          </div>
          ${hasBattery
            ? html`<div class="row">
                <div class="spacer"></div>
                <div class="circle-container battery">
                  <div class="circle">
                    ${batteryChargeState !== null
                      ? html` <span>
                          ${formatNumber(batteryChargeState, this.hass.locale, {
                            maximumFractionDigits: 0,
                            minimumFractionDigits: 0,
                          })}%
                        </span>`
                      : null}
                    <ha-svg-icon .path=${batteryIcon}></ha-svg-icon>
                    <span class="battery-in">
                      <ha-svg-icon
                        class="small"
                        .path=${mdiArrowDown}
                      ></ha-svg-icon
                      >${this.displayValue(totalBatteryIn)}</span
                    >
                    <span class="battery-out">
                      <ha-svg-icon
                        class="small"
                        .path=${mdiArrowUp}
                      ></ha-svg-icon
                      >${this.displayValue(totalBatteryOut)}</span
                    >
                  </div>
                  <span class="label"
                    >${this.hass.localize(
                      "ui.panel.lovelace.cards.energy.energy_distribution.battery"
                    )}</span
                  >
                </div>
                <div class="spacer"></div>
              </div>`
            : ""}
          ${hasSolarProduction
            ? html`<div class="lines ${classMap({ battery: hasBattery })}">
                <svg
                  viewBox="0 0 100 100"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="xMidYMid slice"
                  id="solar-home-flow"
                >
                  <path
                    id="solar"
                    class="solar"
                    d="M${hasBattery ? 55 : 53},0 v${hasGrid
                      ? 15
                      : 17} c0,${hasBattery
                      ? "35 10,30 30,30"
                      : "40 10,35 30,35"} h25"
                    vector-effect="non-scaling-stroke"
                  ></path>
                  ${solarConsumption
                    ? svg`<circle
                            r="1"
                            class="solar"
                            vector-effect="non-scaling-stroke"
                          >
                            <animateMotion
                              dur="${newDur.solarToHome}s"
                              repeatCount="indefinite"
                              calcMode="linear"
                            >
                              <mpath xlink:href="#solar" />
                            </animateMotion>
                          </circle>`
                    : ""}
                </svg>
              </div>`
            : ""}
          ${hasReturnToGrid && hasSolarProduction
            ? html`<div class="lines ${classMap({ battery: hasBattery })}">
                <svg
                  viewBox="0 0 100 100"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="xMidYMid slice"
                  id="solar-grid-flow"
                >
                  <path
                    id="return"
                    class="return"
                    d="M${hasBattery ? 45 : 47},0 v15 c0,${hasBattery
                      ? "35 -10,30 -30,30"
                      : "40 -10,35 -30,35"} h-20"
                    vector-effect="non-scaling-stroke"
                  ></path>
                  ${solarToGrid && hasSolarProduction
                    ? svg`<circle
                        r="1"
                        class="return"
                        vector-effect="non-scaling-stroke"
                      >
                        <animateMotion
                          dur="${newDur.solarToGrid}s"
                          repeatCount="indefinite"
                          calcMode="linear"
                        >
                          <mpath xlink:href="#return" />
                        </animateMotion>
                      </circle>`
                    : ""}
                </svg>
              </div>`
            : ""}
          ${hasBattery && hasSolarProduction
            ? html`<div class="lines ${classMap({ battery: hasBattery })}">
                <svg
                  viewBox="0 0 100 100"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="xMidYMid slice"
                  id="solar-battery-flow"
                >
                  <path
                    id="battery-solar"
                    class="battery-solar"
                    d="M50,0 V100"
                    vector-effect="non-scaling-stroke"
                  ></path>
                  ${solarToBattery
                    ? svg`<circle
                            r="1"
                            class="battery-solar"
                            vector-effect="non-scaling-stroke"
                          >
                            <animateMotion
                              dur="${newDur.solarToBattery}s"
                              repeatCount="indefinite"
                              calcMode="linear"
                            >
                              <mpath xlink:href="#battery-solar" />
                            </animateMotion>
                          </circle>`
                    : ""}
                </svg>
              </div>`
            : ""}
          ${hasGrid
            ? html`<div class="lines ${classMap({ battery: hasBattery })}">
                <svg
                  viewBox="0 0 100 100"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="xMidYMid slice"
                  id="grid-home-flow"
                >
                  <path
                    class="grid"
                    id="grid"
                    d="M0,${hasBattery
                      ? 50
                      : hasSolarProduction
                      ? 56
                      : 53} H100"
                    vector-effect="non-scaling-stroke"
                  ></path>
                  ${gridConsumption
                    ? svg`<circle
                    r="1"
                    class="grid"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${newDur.gridToHome}s"
                      repeatCount="indefinite"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#grid" />
                    </animateMotion>
                  </circle>`
                    : ""}
                </svg>
              </div>`
            : null}
          ${hasBattery
            ? html`<div class="lines ${classMap({ battery: hasBattery })}">
                <svg
                  viewBox="0 0 100 100"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="xMidYMid slice"
                  id="battery-home-flow"
                >
                  <path
                    id="battery-home"
                    class="battery-home"
                    d="M55,100 v-${hasGrid ? 15 : 17} c0,-35 10,-30 30,-30 h20"
                    vector-effect="non-scaling-stroke"
                  ></path>
                  ${batteryConsumption
                    ? svg`<circle
                        r="1"
                        class="battery-home"
                        vector-effect="non-scaling-stroke"
                      >
                        <animateMotion
                          dur="${newDur.batteryToHome}s"
                          repeatCount="indefinite"
                          calcMode="linear"
                        >
                          <mpath xlink:href="#battery-home" />
                        </animateMotion>
                      </circle>`
                    : ""}
                </svg>
              </div>`
            : ""}
          ${hasGrid && hasBattery
            ? html`<div class="lines ${classMap({ battery: hasBattery })}">
                <svg
                  viewBox="0 0 100 100"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="xMidYMid slice"
                  id="battery-grid-flow"
                >
                  <path
                    id="battery-grid"
                    class=${classMap({
                      "battery-from-grid": Boolean(batteryFromGrid),
                      "battery-to-grid": Boolean(batteryToGrid),
                    })}
                    d="M45,100 v-15 c0,-35 -10,-30 -30,-30 h-20"
                    vector-effect="non-scaling-stroke"
                  ></path>
                  ${batteryFromGrid
                    ? svg`<circle
                    r="1"
                    class="battery-from-grid"
                    vector-effect="non-scaling-stroke"
                  >
                    <animateMotion
                      dur="${newDur.batteryGrid}s"
                      repeatCount="indefinite"
                      keyPoints="1;0" keyTimes="0;1"
                      calcMode="linear"
                    >
                      <mpath xlink:href="#battery-grid" />
                    </animateMotion>
                  </circle>`
                    : ""}
                  ${batteryToGrid
                    ? svg`<circle
                        r="1"
                        class="battery-to-grid"
                        vector-effect="non-scaling-stroke"
                      >
                        <animateMotion
                          dur="${newDur.batteryGrid}s"
                          repeatCount="indefinite"
                          calcMode="linear"
                        >
                          <mpath xlink:href="#battery-grid" />
                        </animateMotion>
                      </circle>`
                    : ""}
                </svg>
              </div>`
            : ""}
        </div>
        ${this._config.dashboard_link
          ? html`
              <div class="card-actions">
                <a href=${this._config.dashboard_link}
                  ><mwc-button>
                    ${this.hass.localize(
                      "ui.panel.lovelace.cards.energy.energy_distribution.go_to_energy_dashboard"
                    )}
                  </mwc-button></a
                >
              </div>
            `
          : ""}
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      --mdc-icon-size: 24px;
    }
    .card-content {
      position: relative;
    }
    .lines {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 146px;
      display: flex;
      justify-content: center;
      padding: 0 16px 16px;
      box-sizing: border-box;
    }
    .lines.battery {
      bottom: 100px;
      height: 156px;
    }
    .lines svg {
      width: calc(100% - 160px);
      height: 100%;
      max-width: 340px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      max-width: 500px;
      margin: 0 auto;
    }
    .circle-container {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .circle-container.solar {
      margin: 0 4px;
      height: 130px;
    }
    .circle-container.battery {
      height: 110px;
      justify-content: flex-end;
    }
    .spacer {
      width: 84px;
    }
    .circle {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      box-sizing: border-box;
      border: 2px solid;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 12px;
      line-height: 12px;
      position: relative;
      text-decoration: none;
      color: var(--primary-text-color);
    }
    ha-svg-icon {
      padding-bottom: 2px;
    }
    ha-svg-icon.small {
      --mdc-icon-size: 12px;
    }
    .label {
      color: var(--secondary-text-color);
      font-size: 12px;
    }
    line,
    path {
      stroke: var(--primary-text-color);
      stroke-width: 1;
      fill: none;
    }
    .circle svg {
      position: absolute;
      fill: none;
      stroke-width: 4px;
      width: 100%;
      height: 100%;
      top: 0;
      left: 0;
    }
    .solar {
      color: var(--energy-solar-color);
    }
    .solar .circle {
      border-color: var(--energy-solar-color);
    }
    circle.solar,
    path.solar {
      stroke: var(--energy-solar-color);
    }
    circle.solar {
      stroke-width: 4;
      fill: var(--energy-solar-color);
    }
    .battery .circle {
      border-color: var(--energy-battery-in-color);
    }
    circle.battery,
    path.battery {
      stroke: var(--energy-battery-out-color);
    }
    path.battery-home,
    circle.battery-home {
      stroke: var(--energy-battery-out-color);
    }
    circle.battery-home {
      stroke-width: 4;
      fill: var(--energy-battery-out-color);
    }
    path.battery-solar,
    circle.battery-solar {
      stroke: var(--energy-solar-color);
    }
    circle.battery-solar {
      stroke-width: 4;
      fill: var(--energy-solar-color);
    }
    .battery-in {
      color: var(--energy-battery-in-color);
    }
    .battery-out {
      color: var(--energy-battery-out-color);
    }
    path.battery-from-grid {
      stroke: var(--energy-grid-consumption-color);
    }
    path.battery-to-grid {
      stroke: var(--energy-grid-return-color);
    }
    path.return,
    circle.return,
    circle.battery-to-grid {
      stroke: var(--energy-grid-return-color);
    }
    circle.return,
    circle.battery-to-grid {
      stroke-width: 4;
      fill: var(--energy-grid-return-color);
    }
    .return {
      color: var(--energy-grid-return-color);
    }
    .grid .circle {
      border-color: var(--energy-grid-consumption-color);
    }
    .consumption {
      color: var(--energy-grid-consumption-color);
    }
    circle.grid,
    circle.battery-from-grid,
    path.grid {
      stroke: var(--energy-grid-consumption-color);
    }
    circle.grid,
    circle.battery-from-grid {
      stroke-width: 4;
      fill: var(--energy-grid-consumption-color);
    }
    .home .circle {
      border-width: 0;
      border-color: var(--primary-color);
    }
    .home .circle.border {
      border-width: 2px;
    }
    .circle svg circle {
      animation: rotate-in 0.6s ease-in;
      transition: stroke-dashoffset 0.4s, stroke-dasharray 0.4s;
      fill: none;
    }
    @keyframes rotate-in {
      from {
        stroke-dashoffset: 238.76104;
        stroke-dasharray: 238.76104;
      }
    }
    .card-actions a {
      text-decoration: none;
    }
  `;
}

const windowWithCards = window as unknown as Window & {
  customCards: unknown[];
};
windowWithCards.customCards = windowWithCards.customCards || [];
windowWithCards.customCards.push({
  type: "power-flow-card",
  name: "Power Flow Card",
  description:
    "A power distribution card inspired by the official Energy Distribution card for Home Assistant",
});

declare global {
  interface HTMLElementTagNameMap {
    "power-flow-card": PowerFlowCard;
  }
}
