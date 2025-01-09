import { loadAIBar } from "./lib/ai-bar/loader";
import { useDictateInput } from "./lib/sub-systems/dictate-input";
import { useInterviewInput } from "./lib/sub-systems/interview-input";
import { useMemory } from "./lib/sub-systems/memory";
import { usePaintOutput } from "./lib/sub-systems/paint-output";
import { useDelegatedPushToTalk, useMicrophone } from "./lib/sub-systems/shared";
import { useWritingOutput } from "./lib/sub-systems/writing-output";
import "./main.css";

loadAIBar();
useMicrophone();

// PUSH-TO-TALK
const pushToTalk$ = useDelegatedPushToTalk();
pushToTalk$.subscribe();

// MEMORY CORE
const memory$ = useMemory();
memory$.subscribe();

// INTERVIEW SUB-SYSTEM
const interviewInput$ = useInterviewInput();
interviewInput$.subscribe();

// WRITING SUB-SYSTEM
const writingOutput$ = useWritingOutput();
writingOutput$.subscribe();

// DICTATE SUB-SYSTEM
const dictateInput$ = useDictateInput();
dictateInput$.subscribe();

// PAINT SUB-SYSTEM
const paintOutput$ = usePaintOutput();
paintOutput$.subscribe();
