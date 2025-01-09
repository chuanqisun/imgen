import { fromEvent, merge, tap } from "rxjs";
import { $ } from "../dom";
import { currentWorldXML, EMPTY_XML } from "./shared";

export function useMemory() {
  const xmlPreview = $<HTMLElement>("#xml-preview")!;
  const forgetButton = $<HTMLButtonElement>("#forget")!;
  const renderXML$ = currentWorldXML.pipe(tap((xml) => (xmlPreview.textContent = xml)));
  const forget$ = fromEvent(forgetButton, "click").pipe(tap(() => currentWorldXML.next(EMPTY_XML)));
  const saveButton = $<HTMLButtonElement>("#save")!;
  const loadButton = $<HTMLButtonElement>("#load")!;

  saveButton.addEventListener("click", () => {
    // xml only
    window
      .showSaveFilePicker({
        types: [
          {
            description: "XML files",
            accept: {
              "text/xml": [".xml"],
            },
          },
        ],
        excludeAcceptAllOption: true,
        suggestedName: `memory-frame-${new Date()
          .toISOString()
          .replace(/[:\-T]/g, "")
          .split(".")
          .at(0)}.xml`,
      })
      .then((fileHandle) => {
        fileHandle.createWritable().then((writable) => {
          writable.write(currentWorldXML.value);
          writable.close();
        });
      });
  });

  loadButton.addEventListener("click", () => {
    window.showOpenFilePicker().then((fileHandle) => {
      fileHandle[0].getFile().then((file) => {
        file.text().then((text) => {
          currentWorldXML.next(text);
        });
      });
    });
  });

  return merge(renderXML$, forget$);
}
