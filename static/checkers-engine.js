(function (root, factory) {
  const engine = factory();
  if (typeof module === "object" && module.exports) module.exports = engine;
  if (root) root.CheckersEngine = engine;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BLUE_KEYS = ["q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"];
  const BLUE_STARTS = [
    [5, 0], [5, 2], [5, 4], [5, 6], [6, 1], [6, 3],
    [6, 5], [6, 7], [7, 0], [7, 2], [7, 4], [7, 6]
  ];
  const FORWARD = {
    red: [[1, -1], [1, 1]],
    blue: [[-1, -1], [-1, 1]]
  };
  const KING_DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function sideOf(piece) {
    if (piece === 1 || piece === 3) return "red";
    if (piece === 2 || piece === 4) return "blue";
    return null;
  }

  function isKing(piece) {
    return piece === 3 || piece === 4;
  }

  function makeBoard() {
    return Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => {
        if ((row + col) % 2 === 0) return 0;
        if (row < 3) return 1;
        if (row > 4) return 2;
        return 0;
      })
    );
  }

  function createInitialState() {
    const blueKeyPositions = {};
    BLUE_KEYS.forEach((key, index) => {
      blueKeyPositions[key] = BLUE_STARTS[index].slice();
    });
    return {
      board: makeBoard(),
      turn: "blue",
      selected: null,
      kbSelected: null,
      chain: false,
      blueSteps: 0,
      blueKeyPositions,
      winner: null,
      endReason: null
    };
  }

  function directionsFor(piece) {
    if (isKing(piece)) return KING_DIRECTIONS;
    return sideOf(piece) === "red" ? FORWARD.red : FORWARD.blue;
  }

  function listMoves(state, side, onlyFrom) {
    const board = state.board;
    const jumps = [];
    const steps = [];
    const visit = (row, col) => {
      const piece = board[row][col];
      if (sideOf(piece) !== side) return;
      for (const [dr, dc] of directionsFor(piece)) {
        const nextRow = row + dr;
        const nextCol = col + dc;
        if (inBounds(nextRow, nextCol) && board[nextRow][nextCol] === 0) {
          steps.push({ from: [row, col], to: [nextRow, nextCol], capture: null });
        }

        const jumpRow = row + dr * 2;
        const jumpCol = col + dc * 2;
        if (!inBounds(jumpRow, jumpCol) || board[jumpRow][jumpCol] !== 0) continue;
        const midRow = row + dr;
        const midCol = col + dc;
        if (sideOf(board[midRow][midCol]) && sideOf(board[midRow][midCol]) !== side) {
          jumps.push({
            from: [row, col],
            to: [jumpRow, jumpCol],
            capture: [midRow, midCol]
          });
        }
      }
    };

    if (onlyFrom) visit(onlyFrom[0], onlyFrom[1]);
    else {
      for (let row = 0; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) visit(row, col);
      }
    }

    if (side === "red" && !onlyFrom && jumps.length) return jumps;
    if (state.chain && onlyFrom) return jumps;
    return jumps.concat(steps);
  }

  function getBlueMoves(state) {
    if (state.turn !== "blue" || state.winner) return [];
    return listMoves(state, "blue", state.chain ? state.selected : null);
  }

  function getSelectedMoves(state) {
    if (!state.selected || state.turn !== "blue" || state.winner) return [];
    return listMoves(state, "blue", state.selected);
  }

  function hasAvailableJumps(state, row, col) {
    const piece = state.board[row][col];
    if (!piece) return false;
    for (const [dr, dc] of directionsFor(piece)) {
      const toRow = row + dr * 2;
      const toCol = col + dc * 2;
      const middle = state.board[row + dr]?.[col + dc];
      if (inBounds(toRow, toCol) && state.board[toRow][toCol] === 0 &&
          sideOf(middle) && sideOf(middle) !== sideOf(piece)) return true;
    }
    return false;
  }

  function updateBlueTracker(state, from, to) {
    for (const key of BLUE_KEYS) {
      const pos = state.blueKeyPositions[key];
      if (pos && pos[0] === from[0] && pos[1] === from[1]) {
        state.blueKeyPositions[key] = to.slice();
        return;
      }
    }
  }

  function removeBlueTrackerPosition(state, at) {
    for (const key of BLUE_KEYS) {
      const pos = state.blueKeyPositions[key];
      if (pos && pos[0] === at[0] && pos[1] === at[1]) {
        state.blueKeyPositions[key] = null;
        return;
      }
    }
  }

  function countPieces(state) {
    let red = 0;
    let blue = 0;
    for (const row of state.board) {
      for (const piece of row) {
        if (sideOf(piece) === "red") red += 1;
        if (sideOf(piece) === "blue") blue += 1;
      }
    }
    return { red, blue };
  }

  function canSideMove(state, side) {
    // Match the original Tkinter endgame scan exactly: one-square moves honor
    // man direction, but its two-square capture scan checks all four diagonals.
    // This intentionally differs from listMoves / the move validator for men.
    const board = state.board;
    const moveDirections = KING_DIRECTIONS;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = board[row][col];
        if (sideOf(piece) !== side) continue;
        for (const [dr, dc] of moveDirections) {
          const stepRow = row + dr;
          const stepCol = col + dc;
          if (inBounds(stepRow, stepCol) && board[stepRow][stepCol] === 0) {
            if (isKing(piece)) return true;
            if (side === "red" && dr > 0) return true;
            if (side === "blue" && dr < 0) return true;
          }

          const jumpRow = row + dr * 2;
          const jumpCol = col + dc * 2;
          if (inBounds(jumpRow, jumpCol) && board[jumpRow][jumpCol] === 0) {
            const midRow = row + dr;
            const midCol = col + dc;
            if (sideOf(board[midRow][midCol]) && sideOf(board[midRow][midCol]) !== side) return true;
          }
        }
      }
    }
    return false;
  }

  function finishTurn(state, side) {
    state.chain = false;
    state.selected = null;
    if (side === "blue") {
      state.blueSteps += 1;
      state.turn = "red";
    } else {
      state.turn = "blue";
    }
    return detectGameOver(state);
  }

  function detectGameOver(state) {
    if (state.winner) return state.winner;
    const counts = countPieces(state);
    if (counts.red === 0 || !canSideMove(state, "red")) {
      state.winner = "blue";
      state.endReason = "red";
    } else if (counts.blue === 0 || !canSideMove(state, "blue")) {
      state.winner = "red";
      state.endReason = "blue";
    }
    return state.winner;
  }

  function applyBlueDestination(state, row, col) {
    if (state.turn !== "blue" || state.winner) {
      return { changed: false, message: "現在不是藍棋回合。" };
    }
    if (!inBounds(row, col)) return { changed: false, message: "落點超出棋盤。" };
    const targetPiece = state.board[row][col];

    if (targetPiece) {
      if (state.chain) {
        return { changed: false, message: "連吃進行中，請移動標示中的同一枚藍棋。" };
      }
      if (sideOf(targetPiece) === "blue") {
        state.selected = [row, col];
        return { changed: true, selected: true, message: "已選取藍棋，選擇斜向落點。" };
      }
      return { changed: false, message: "這是紅棋，現在由你操作藍棋。" };
    }

    if (!state.selected) return { changed: false, message: "先選擇一枚藍棋。" };
    const [fromRow, fromCol] = state.selected;
    const piece = state.board[fromRow][fromCol];
    if (sideOf(piece) !== "blue") {
      state.selected = null;
      state.chain = false;
      return { changed: true, message: "棋子位置已更新，請重新選擇。" };
    }

    const rowDiff = row - fromRow;
    const colDiff = col - fromCol;
    const directionOK = isKing(piece) || rowDiff < 0;
    if (!directionOK) {
      return { changed: false, message: "藍兵只能向前；只有國王可以向後移動。" };
    }

    if (Math.abs(rowDiff) === 1 && Math.abs(colDiff) === 1) {
      if (state.chain) {
        return { changed: false, message: "必須繼續跳吃，不能以普通斜走結束連吃。" };
      }
      state.board[row][col] = piece;
      state.board[fromRow][fromCol] = 0;
      updateBlueTracker(state, [fromRow, fromCol], [row, col]);
      let promoted = false;
      if (piece === 2 && row === 0) {
        state.board[row][col] = 4;
        promoted = true;
      }
      const winner = finishTurn(state, "blue");
      return { changed: true, moved: true, promoted, winner, message: promoted ? "藍兵升為國王，藍棋回合完成。" : "藍棋回合完成。" };
    }

    if (Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 2) {
      const midRow = (fromRow + row) / 2;
      const midCol = (fromCol + col) / 2;
      const captured = state.board[midRow][midCol];
      if (sideOf(captured) !== "red") {
        return { changed: false, message: "跳吃路徑中沒有紅棋，請選擇其他落點。" };
      }
      state.board[row][col] = piece;
      state.board[fromRow][fromCol] = 0;
      state.board[midRow][midCol] = 0;
      updateBlueTracker(state, [fromRow, fromCol], [row, col]);
      let promoted = false;
      if (piece === 2 && row === 0) {
        state.board[row][col] = 4;
        promoted = true;
      }
      if (hasAvailableJumps(state, row, col)) {
        state.chain = true;
        state.selected = [row, col];
        return { changed: true, moved: true, captured: true, promoted, chain: true, message: promoted ? "升為國王！還能繼續連吃，藍棋保持鎖定。" : "跳吃成功，還能繼續連吃；同一枚藍棋已鎖定。" };
      }
      const winner = finishTurn(state, "blue");
      return { changed: true, moved: true, captured: true, promoted, winner, message: promoted ? "升為國王，藍棋回合完成。" : "跳吃成功，藍棋回合完成。" };
    }

    if (state.chain) {
      const winner = finishTurn(state, "blue");
      return { changed: true, chainEnded: true, winner, message: "已結束連吃，交由紅棋行動。" };
    }
    return { changed: false, message: "請沿斜線移動一格，或跳過一枚相鄰紅棋。" };
  }

  function selectBlueByKey(state, key) {
    const normalized = String(key).toLowerCase();
    if (!BLUE_KEYS.includes(normalized)) return { changed: false };
    if (state.turn !== "blue" || state.winner) {
      return { changed: false, message: "目前不是藍棋回合。" };
    }
    const pos = state.blueKeyPositions[normalized];
    if (!pos) return { changed: false, message: `按鍵 ${normalized.toUpperCase()} 對應的藍棋已被吃掉。` };
    // The original keyboard handler changes both selections even during a
    // chain; the click/mouse path does not apply this key-selection guard.
    state.kbSelected = pos.slice();
    state.selected = pos.slice();
    return { changed: true, selected: true, message: `已選取藍棋 ${normalized.toUpperCase()}，按 1、2、4 或 5 移動。` };
  }

  function moveBlueByDirection(state, key) {
    const directions = {
      "1": [-1, -1],
      "2": [-1, 1],
      "4": [1, -1],
      "5": [1, 1]
    };
    const vector = directions[String(key)];
    if (!vector) return { changed: false };
    if (!state.kbSelected) return { changed: false };
    const [row, col] = state.kbSelected;
    const piece = state.board[row][col];
    if (!isKing(piece) && vector[0] > 0) {
      return { changed: false, message: "藍兵不能向後；4、5 方向只供國王使用。" };
    }
    let toRow = row + vector[0];
    let toCol = col + vector[1];
    if (inBounds(toRow, toCol) && sideOf(state.board[toRow][toCol]) === "red") {
      toRow += vector[0];
      toCol += vector[1];
    }
    if (!inBounds(toRow, toCol)) {
      if (!state.chain) {
        state.kbSelected = null;
        state.selected = null;
      }
      return { changed: false, message: "這個方向已超出棋盤。" };
    }
    const result = applyBlueDestination(state, toRow, toCol);
    if (state.chain) {
      const matchingKey = BLUE_KEYS.find((blueKey) => {
        const pos = state.blueKeyPositions[blueKey];
        return pos && pos[0] === toRow && pos[1] === toCol;
      });
      if (matchingKey) {
        state.kbSelected = [toRow, toCol];
        state.selected = [toRow, toCol];
        return result;
      }
    }
    // The Tk key handler clears only kb_selected after any in-bounds
    // directional attempt that did not continue a chain. selected_piece is
    // left exactly as the click handler left it, even when that click failed.
    state.kbSelected = null;
    return result;
  }

  function chooseRedMove(state, randomFn) {
    if (state.turn !== "red" || state.winner) return null;
    let moves;
    if (state.chain && state.selected) {
      moves = listMoves(state, "red", state.selected);
    } else {
      moves = listMoves(state, "red", null);
    }
    if (!moves.length) return null;
    const randomValue = typeof randomFn === "function" ? randomFn() : Math.random();
    const index = Math.max(0, Math.min(moves.length - 1, Math.floor(randomValue * moves.length)));
    return moves[index];
  }

  function playRedMove(state, move) {
    if (state.turn !== "red" || state.winner || !move) {
      return { changed: false, message: "紅棋目前沒有可執行的步數。" };
    }
    const [fromRow, fromCol] = move.from;
    const [toRow, toCol] = move.to;
    const piece = state.board[fromRow][fromCol];
    if (sideOf(piece) !== "red" || state.board[toRow][toCol] !== 0) {
      return { changed: false, message: "紅棋步數已失效。" };
    }
    state.board[toRow][toCol] = piece;
    state.board[fromRow][fromCol] = 0;
    let promoted = false;
    if (piece === 1 && toRow === 7) {
      state.board[toRow][toCol] = 3;
      promoted = true;
    }
    if (move.capture) {
      const [captureRow, captureCol] = move.capture;
      const captured = state.board[captureRow][captureCol];
      if (sideOf(captured) === "blue") removeBlueTrackerPosition(state, [captureRow, captureCol]);
      state.board[captureRow][captureCol] = 0;
      if (hasAvailableJumps(state, toRow, toCol)) {
        state.chain = true;
        state.selected = [toRow, toCol];
        return { changed: true, capture: true, promoted, chain: true, message: "紅棋跳吃，正在自動連吃。" };
      }
    }
    const winner = finishTurn(state, "red");
    return { changed: true, capture: Boolean(move.capture), promoted, winner, message: promoted ? "紅兵升為國王，換你走棋。" : "紅棋走完，換你走棋。" };
  }

  return {
    BLUE_KEYS,
    createInitialState,
    countPieces,
    detectGameOver,
    getBlueMoves,
    getSelectedMoves,
    applyBlueDestination,
    selectBlueByKey,
    moveBlueByDirection,
    chooseRedMove,
    playRedMove,
    sideOf,
    isKing,
    hasAvailableJumps,
    canSideMove,
    inBounds
  };
});
