import { BehaviorSubject } from "rxjs";

export const EMPTY_XML = "<world></world>";

export const currentWorldXML = new BehaviorSubject(EMPTY_XML);

// TOOLS
export function update_by_script(scene$: BehaviorSubject<string>, args: { script: string }) {
  console.log(`[tool] script`, args.script);
  const fn = new Function("document", "world", args.script);
  try {
    const existingXml = scene$.value;
    const doc = new DOMParser().parseFromString(scene$.value, "application/xml");
    fn(doc, doc.querySelector("world")!);
    const xml = new XMLSerializer().serializeToString(doc);
    console.log(`[scene] updated`, { existingXml, newXml: xml });
    scene$.next(xml);
    return `Done`;
  } catch (e) {
    return `Error: ${(e as any).message}`;
  }
}

export function rewrite_xml(scene$: BehaviorSubject<string>, args: { xml: string }) {
  console.log(`[tool] rewrite`, args.xml);

  scene$.next(args.xml);
  return `Done`;
}
