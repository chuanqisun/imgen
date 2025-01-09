import { BehaviorSubject, filter, fromEvent, map, merge, tap } from "rxjs";
import type { AzureSttNode } from "../ai-bar/lib/elements/azure-stt-node";
import type { AzureTtsNode } from "../ai-bar/lib/elements/azure-tts-node";
import type { AIBarEventDetail } from "../ai-bar/lib/events";
import { $, parseActionEvent, preventDefault, stopPropagation } from "../dom";

export const EMPTY_XML = "<world></world>";

export const currentWorldXML = new BehaviorSubject(EMPTY_XML);

export function useMicrophone() {
  const talkButton = $<HTMLButtonElement>("#use-microphone")!;
  const azureSttNode = $<AzureSttNode>("azure-stt-node")!;
  const azureTtsNode = $<AzureTtsNode>("azure-tts-node")!;

  talkButton.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      azureSttNode.startMicrophone();
      azureTtsNode.startSpeaker();
      talkButton.remove();
    },
    { once: true },
  );
}

export let sttTargetElement: HTMLInputElement | null = null;
let shouldClear = false;
export function useDelegatedPushToTalk() {
  const azureSttNode = $<AzureSttNode>("azure-stt-node")!;
  const azureTtsNode = $<AzureTtsNode>("azure-tts-node")!;

  const delegatedPushToTalk$ = merge(
    fromEvent(document, "mousedown").pipe(
      map(parseActionEvent),
      filter((e) => e.action === "talk"),
      tap((e) => {
        (e.trigger as HTMLButtonElement).textContent = "Send";
        azureTtsNode.clear();
        azureSttNode.start();
        shouldClear = !e.trigger?.hasAttribute("data-incremental");
        sttTargetElement =
          $<HTMLInputElement>(`#${(e.trigger as HTMLElement).getAttribute("data-talk") ?? ""}`) ?? null;
      }),
    ),
    fromEvent(document, "mouseup").pipe(
      map(parseActionEvent),
      filter((e) => e.action === "talk"),
      tap((e) => {
        (e.trigger as HTMLButtonElement).textContent = "Talk";
        azureSttNode.stop();
      }),
    ),
  );

  const delegatedRecognition$ = fromEvent<CustomEvent<AIBarEventDetail>>(azureSttNode, "event").pipe(
    tap(preventDefault),
    tap(stopPropagation),
    map((e) => (e as CustomEvent<AIBarEventDetail>).detail.recognized?.text as string),
    filter((v) => !!v?.length),
    tap((text) => {
      if (!sttTargetElement) return;
      if (shouldClear) sttTargetElement.value = "";
      if (sttTargetElement.value) text = sttTargetElement.value + " " + text;
      sttTargetElement.value = text;
    }),
  );

  return merge(delegatedPushToTalk$, delegatedRecognition$);
}

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
