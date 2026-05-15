import bwipjs from "bwip-js/node";

export function renderCode128SVG(value: string): string {
  return bwipjs.toSVG({
    bcid: "code128",
    text: value,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: "center",
    textsize: 9,
  });
}
