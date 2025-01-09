import { merge } from "rxjs";
import { loadAIBar } from "./lib/ai-bar/loader";
import { useDictateInput } from "./lib/sub-systems/dictate-input";
import { useDiscussionOutput } from "./lib/sub-systems/discussion-output";
import { useInterviewInput } from "./lib/sub-systems/interview-input";
import { useMemory } from "./lib/sub-systems/memory";
import { usePaintOutput } from "./lib/sub-systems/paint-output";
import { useDelegatedPushToTalk, useMicrophone } from "./lib/sub-systems/shared";
import { useShowInput } from "./lib/sub-systems/show-input";
import { useWritingOutput } from "./lib/sub-systems/writing-output";
import "./main.css";

loadAIBar();
useMicrophone();

merge(
  useDelegatedPushToTalk(),
  useMemory(),
  useShowInput(),
  useInterviewInput(),
  useWritingOutput(),
  useDictateInput(),
  usePaintOutput(),
  useDiscussionOutput(),
).subscribe();
