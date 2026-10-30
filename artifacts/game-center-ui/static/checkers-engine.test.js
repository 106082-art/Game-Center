"use strict";

const assert = require("node:assert/strict");
const Engine = require("./checkers-engine.js");

function emptyState() {
  const state = Engine.createInitialState();
  state.board = Array.from({ length: 8 }, () => Array(8).fill(0));
  state.turn = "blue";
  state.selected = null;
  state.kbSelected = null;
  state.chain = false;
  state.winner = null;
  state.endReason = null;
  return state;
}

// During a chain the source key handler can select another blue piece and
// attempt a jump with it. If that jump continues the chain, keyboard selection
// follows the moved piece; the next in-bounds key completing the chain clears
// kbSelected but leaves selected_piece as the click handler did.
{
  const state = emptyState();
  state.board[3][2] = 2;
  state.board[2][3] = 1;
  state.board[5][4] = 2;
  state.board[4][5] = 1;
  state.board[2][5] = 1;
  state.blueKeyPositions.q = [3, 2];
  state.blueKeyPositions.w = [5, 4];
  state.chain = true;
  state.selected = [3, 2];

  assert.equal(Engine.selectBlueByKey(state, "w").changed, true);
  assert.deepEqual(state.selected, [5, 4]);
  assert.deepEqual(state.kbSelected, [5, 4]);

  const continued = Engine.moveBlueByDirection(state, "2");
  assert.equal(continued.chain, true);
  assert.deepEqual(state.selected, [3, 6]);
  assert.deepEqual(state.kbSelected, [3, 6]);

  const completed = Engine.moveBlueByDirection(state, "1");
  assert.equal(completed.chain, undefined);
  assert.equal(state.chain, false);
  assert.equal(state.kbSelected, null);
  assert.equal(state.selected, null);
}

// An in-bounds key attempt clears kbSelected even when the click validator
// rejects the destination, while preserving selected_piece.
{
  const state = emptyState();
  state.board[5][0] = 2;
  state.board[4][1] = 1;
  state.board[3][2] = 1;
  state.blueKeyPositions.q = [5, 0];
  Engine.selectBlueByKey(state, "q");

  const result = Engine.moveBlueByDirection(state, "2");
  assert.equal(result.changed, false);
  assert.equal(state.kbSelected, null);
  assert.deepEqual(state.selected, [5, 0]);
}

// Out-of-bounds direction clears both selections when no chain is active.
{
  const state = emptyState();
  state.board[5][0] = 2;
  state.blueKeyPositions.q = [5, 0];
  Engine.selectBlueByKey(state, "q");

  const result = Engine.moveBlueByDirection(state, "1");
  assert.equal(result.changed, false);
  assert.equal(state.kbSelected, null);
  assert.equal(state.selected, null);
}

// An out-of-bounds direction during a chain leaves both selections untouched.
{
  const state = emptyState();
  state.board[5][0] = 2;
  state.blueKeyPositions.q = [5, 0];
  state.chain = true;
  state.selected = [5, 0];
  state.kbSelected = [5, 0];

  const result = Engine.moveBlueByDirection(state, "1");
  assert.equal(result.changed, false);
  assert.deepEqual(state.kbSelected, [5, 0]);
  assert.deepEqual(state.selected, [5, 0]);
}

// Direction keys are not turn-gated in the source handler: a stale keyboard
// selection is cleared by an in-bounds attempt during Red's ordinary turn.
{
  const state = emptyState();
  state.turn = "red";
  state.board[5][0] = 2;
  state.blueKeyPositions.q = [5, 0];
  state.kbSelected = [5, 0];

  const result = Engine.moveBlueByDirection(state, "2");
  assert.equal(result.changed, false);
  assert.equal(state.kbSelected, null);
  assert.equal(state.selected, null);
}

// Regression: the Tkinter game-over scan counts a man's backward jump as
// mobility, while the actual move handler correctly rejects that same move.
{
  const state = emptyState();
  state.board[3][3] = 2;
  state.board[4][4] = 1;
  state.board[2][2] = 1;
  state.board[2][4] = 1;
  state.board[1][1] = 1;
  state.board[1][3] = 1;
  state.board[1][5] = 1;
  state.selected = [3, 3];

  assert.equal(Engine.canSideMove(state, "blue"), true);
  assert.deepEqual(Engine.getSelectedMoves(state), []);
  const result = Engine.applyBlueDestination(state, 5, 5);
  assert.equal(result.changed, false);
  assert.match(result.message, /只能向前/);
}

console.log("checkers-engine regression tests passed");
