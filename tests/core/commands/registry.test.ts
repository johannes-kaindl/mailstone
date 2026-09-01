import { describe, it, expect, beforeEach } from "vitest";
import { registerCommands, resetCommands, commandRegistry, findCommand, commandsFor } from "../../../src/core/commands/registry";
import { EMPTY_SCHEMA, type CommandDescriptor, type CommandProbe } from "../../../src/core/commands/types";

function descriptor(id: string, applies: boolean): CommandDescriptor {
  return {
    id, title: id, titleKey: `cmd.${id}.title`, description: "", descriptionKey: `cmd.${id}.desc`,
    schema: EMPTY_SCHEMA,
    appliesTo: () => applies,
    plan: () => ({ ok: false, code: "nothing-to-do" }),
  };
}

const probe = {} as CommandProbe;

describe("Kommando-Registry", () => {
  beforeEach(() => { resetCommands(); });

  it("registriert und findet ein Kommando", () => {
    registerCommands([descriptor("mail.x", true)]);
    expect(findCommand("mail.x")?.id).toBe("mail.x");
    expect(commandRegistry()).toHaveLength(1);
  });

  it("wirft bei doppelter ID", () => {
    registerCommands([descriptor("mail.x", true)]);
    expect(() => { registerCommands([descriptor("mail.x", true)]); }).toThrow(/Doppelte Kommando-ID/);
  });

  it("commandsFor filtert ueber appliesTo", () => {
    registerCommands([descriptor("mail.ja", true), descriptor("mail.nein", false)]);
    expect(commandsFor(probe).map((c) => c.id)).toEqual(["mail.ja"]);
  });

  it("commandRegistry liefert eine Kopie, kein Handle auf den Zustand", () => {
    registerCommands([descriptor("mail.x", true)]);
    commandRegistry().pop();
    expect(commandRegistry()).toHaveLength(1);
  });
});
