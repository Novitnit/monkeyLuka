/**
 * Unit tests for the quest gate (`quest-gate.ts`): correct answers complete
 * the interaction tile they came from (it can never be answered again), and
 * a door-link group's doors flip open the moment every showquest interaction
 * the group links is completed — verified against both synthetic groups and
 * the real map's room1 group (1 signpost → 1 door).
 */
import { describe, expect, test } from "bun:test";
import {
  ROOM_OBJECT_GROUP_NAME,
  TILE_DOOR_BOTTOM_LEFT,
  TILE_DOOR_BOTTOM_RIGHT,
  TILE_DOOR_TOP_LEFT,
  TILE_DOOR_TOP_RIGHT,
  TILE_INTERACTION,
  groupRoomObjectsByName,
  type DoorEntity,
  type DoorLinkGroup,
} from "@monkeyluka/shared";
import { parseJungleMap } from "../../game/jungle-map";
import { QuestGate } from "./quest-gate";

function door(tx: number, ty: number): DoorEntity {
  return { tx, ty, cols: 2, rows: 2, state: "closed" };
}

function group(
  name: string,
  showquest: Array<{ tx: number; ty: number }>,
  doors: DoorEntity[],
): DoorLinkGroup {
  return { name, objects: [], showquest, doors };
}

describe("quest gate", () => {
  test("a completed interaction can never be answered again", () => {
    const gate = new QuestGate([]);
    expect(gate.isCompleted(17, 11)).toBe(false);
    expect(gate.markCompleted(17, 11)).toEqual([]);
    expect(gate.isCompleted(17, 11)).toBe(true);
    // Re-completing the same tile is a silent no-op.
    expect(gate.markCompleted(17, 11)).toEqual([]);
    // A different tile is untouched.
    expect(gate.isCompleted(17, 12)).toBe(false);
  });

  test("partial completion never opens the group's doors", () => {
    const doorA = door(2, 3);
    const doorB = door(8, 5);
    const gate = new QuestGate([
      group("gate1", [{ tx: 17, ty: 11 }, { tx: 20, ty: 11 }], [doorA, doorB]),
    ]);

    expect(gate.markCompleted(17, 11)).toEqual([]);
    expect(doorA.state).toBe("closed");
    expect(doorB.state).toBe("closed");
  });

  test("completing every linked showquest opens the group's doors", () => {
    const doorA = door(2, 3);
    const gate = new QuestGate([
      group("gate1", [{ tx: 17, ty: 11 }, { tx: 20, ty: 11 }], [doorA]),
    ]);

    expect(gate.markCompleted(17, 11)).toEqual([]);
    const opened = gate.markCompleted(20, 11);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toBe(doorA);
    // The entity itself reports the new state (the caller mirrors it into
    // its validation grid + synced schema).
    expect(doorA.state).toBe("open");
  });

  test("an already-open door is not re-opened when its group completes later", () => {
    const doorA = door(2, 3);
    // Two groups share the door; the first to complete opens it. The second
    // group's completion must not return it again.
    const gate = new QuestGate([
      group("first", [{ tx: 17, ty: 11 }], [doorA]),
      group("second", [{ tx: 20, ty: 11 }], [doorA]),
    ]);

    expect(gate.markCompleted(17, 11)).toHaveLength(1);
    expect(doorA.state).toBe("open");
    expect(gate.markCompleted(20, 11)).toEqual([]);
    expect(doorA.state).toBe("open");
  });

  test("a door group with no showquests never opens (nothing gates it)", () => {
    const orphaned = door(2, 3);
    // A door stranded in its own solo-name group (e.g. a room-object name
    // mismatch that left the signpost in another group): an empty
    // `showquest` must not be vacuously "all answered" by an unrelated
    // correct answer.
    const gate = new QuestGate([
      group("orphan", [], [orphaned]),
      group("gate1", [{ tx: 17, ty: 11 }], []),
    ]);

    expect(gate.markCompleted(17, 11)).toEqual([]);
    expect(orphaned.state).toBe("closed");
  });

  test("a room's sole signpost opens its sole door (gate end to end)", () => {
    // Synthetic raw map shaped like the shipped level's room1 gate: one
    // `room1` rectangle over the 315 signpost at (17, 11) and the 2×2 door
    // block at (29, 8). It runs through the real loader + grouping so the
    // whole link pipeline is exercised — and it is built in-test, so a map
    // edit can't move or remove the gate. Answering the signpost completes
    // it, and since it's the only linked showquest, the door opens.
    const width = 40;
    const height = 17;
    const gids = new Array<number>(width * height).fill(0);
    gids[11 * width + 17] = TILE_INTERACTION;
    gids[8 * width + 29] = TILE_DOOR_TOP_LEFT;
    gids[8 * width + 30] = TILE_DOOR_TOP_RIGHT;
    gids[9 * width + 29] = TILE_DOOR_BOTTOM_LEFT;
    gids[9 * width + 30] = TILE_DOOR_BOTTOM_RIGHT;
    const parsed = parseJungleMap({
      width,
      height,
      layers: [
        { type: "tilelayer", name: "layer1", width, height, data: gids },
        {
          type: "objectgroup",
          name: ROOM_OBJECT_GROUP_NAME,
          objects: [
            { id: 1, name: "room1", x: 0, y: 0, width: 496, height: 272 },
          ],
        },
      ],
    });
    const gate = new QuestGate(
      groupRoomObjectsByName(
        parsed.roomObjects,
        parsed.doors,
        parsed.interactions,
      ),
    );

    expect(gate.isCompleted(17, 11)).toBe(false);
    const opened = gate.markCompleted(17, 11);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ tx: 29, ty: 8, state: "open" });
    expect(gate.isCompleted(17, 11)).toBe(true);
    // Completing it again changes nothing.
    expect(gate.markCompleted(17, 11)).toEqual([]);
  });
});