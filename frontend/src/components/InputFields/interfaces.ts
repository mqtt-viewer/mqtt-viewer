import type { IconType } from "../Icon/icons";

export interface ActionButton {
  icon: IconType;
  size?: number;
  onClick?: (e: MouseEvent) => void;
  buttonClass?: string;
  tooltipText?: string;
}
