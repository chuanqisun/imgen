import { fromEvent, merge, tap } from "rxjs";
import { $ } from "../dom";
import { currentWorldXML, EMPTY_XML } from "./shared";

export function useMemory() {
  const xmlPreview = $<HTMLElement>("#xml-preview")!;
  const forgetButton = $<HTMLButtonElement>("#forget")!;
  const renderXML$ = currentWorldXML.pipe(tap((xml) => (xmlPreview.textContent = xml)));
  const forget$ = fromEvent(forgetButton, "click").pipe(tap(() => currentWorldXML.next(EMPTY_XML)));

  return merge(renderXML$, forget$);
}
