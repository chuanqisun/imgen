import xmlFormat from "xml-formatter";
export function formatXml(xml: string): string {
  return xmlFormat(xml, {
    indentation: "  ",
    lineSeparator: "\n",
    forceSelfClosingEmptyTag: false,
  });
}
