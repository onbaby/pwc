import type { ChannelName, PersonaId } from "@rot/contracts";

/** The flow engine talks only to this (spec 7.1). Every channel is mirrored on screen by the phone mock. */
export interface Channel {
  name: ChannelName;
  /** Begin receiving. `onInbound` gets the persona (or undefined for an unknown sender) and the text. */
  start(onInbound: (persona: PersonaId | undefined, text: string) => void): Promise<void>;
  send(persona: PersonaId, text: string): Promise<void>;
  stop?(): Promise<void>;
}
