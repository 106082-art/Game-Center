(function () {
  "use strict";

  const Engine = window.CheckersEngine;
  const $ = (id) => document.getElementById(id);
  const setupView = $("setup-view");
  const gameView = $("game-view");
  const endView = $("end-view");
  const boardElement = $("checker-board");
  const stateRef = { current: null };
  const botTimer = { current: null };
  let botTurnToken = 0;
  const keyByPosition = new Map();
  const selectedMoves = [];

  const positionKey = (row, col) => `${row},${col}`;
  const samePosition = (a, b) => Boolean(a && b && a[0] === b[0] && a[1] === b[1]);

  function setupBlueKeyLookup(state) {
    keyByPosition.clear();
    Engine.BLUE_KEYS.forEach((key) => {
      const pos = state.blueKeyPositions[key];
      if (pos) keyByPosition.set(positionKey(pos[0], pos[1]), key);
    });
  }

  function showView(view) {
    setupView.hidden = view !== "setup";
    gameView.hidden = view !== "game";
    endView.hidden = view !== "end";
  }

  function getLegalTargets(state) {
    if (!state.selected || state.turn !== "blue") return [];
    return Engine.getSelectedMoves(state).map((move) => ({
      row: move.to[0],
      col: move.to[1],
      capture: Boolean(move.capture)
    }));
  }

  function renderBoard() {
    const state = stateRef.current;
    if (!state) return;
    setupBlueKeyLookup(state);
    const targets = getLegalTargets(state);
    const targetLookup = new Map(targets.map((item) => [positionKey(item.row, item.col), item]));
    const fragment = document.createDocumentFragment();

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const pieceType = state.board[row][col];
        const square = document.createElement("button");
        square.type = "button";
        square.className = `square ${(row + col) % 2 === 0 ? "is-light" : "is-dark"}`;
        square.dataset.row = String(row);
        square.dataset.col = String(col);
        square.setAttribute("role", "gridcell");
        const coordinate = `${String.fromCharCode(65 + col)}${8 - row}`;
        const side = Engine.sideOf(pieceType);
        const pieceName = side === "red" ? "紅棋" : side === "blue" ? "藍棋" : "空格";
        const kingName = Engine.isKing(pieceType) ? "國王" : "";
        square.setAttribute("aria-label", `${coordinate} ${pieceName}${kingName ? ` ${kingName}` : ""}`);

        if (state.selected && state.selected[0] === row && state.selected[1] === col) {
          square.classList.add("is-selected");
          square.setAttribute("aria-pressed", "true");
        }
        const destination = targetLookup.get(positionKey(row, col));
        if (destination) {
          square.classList.add("is-legal");
          if (destination.capture) square.classList.add("is-capture-destination");
        }

        if (pieceType) {
          const piece = document.createElement("span");
          piece.className = `piece is-${side}${Engine.isKing(pieceType) ? " is-king" : ""}`;
          piece.setAttribute("aria-hidden", "true");
          const key = side === "blue" ? keyByPosition.get(positionKey(row, col)) : null;
          if (key) {
            const keyBadge = document.createElement("span");
            keyBadge.className = "piece-key";
            keyBadge.textContent = key.toUpperCase();
            piece.append(keyBadge);
          }
          square.append(piece);
        }
        square.addEventListener("click", onSquareClick);
        fragment.append(square);
      }
    }
    boardElement.replaceChildren(fragment);
  }

  function setNotice(message, kind) {
    const notice = $("game-notice");
    notice.textContent = message || "";
    notice.classList.toggle("is-error", kind === "error");
    notice.classList.toggle("is-good", kind === "good");
  }

  function updateStatus(message) {
    const state = stateRef.current;
    if (!state) return;
    const counts = Engine.countPieces(state);
    const turnChip = $("turn-chip");
    const turnLabel = $("turn-label");
    const statusTitle = $("status-title");
    const statusCopy = $("status-copy");

    $("red-count").textContent = String(counts.red);
    $("blue-count").textContent = String(counts.blue);
    $("blue-steps").textContent = String(state.blueSteps).padStart(2, "0");
    $("turn-number").textContent = String(Math.max(1, state.blueSteps + 1)).padStart(2, "0");
    turnChip.classList.toggle("is-red", state.turn === "red");
    turnChip.classList.toggle("is-thinking", state.turn === "red" && !state.winner);

    if (state.winner) {
      turnLabel.textContent = "棋局結束";
      statusTitle.textContent = state.winner === "blue" ? "藍棋獲勝" : "紅棋獲勝";
      statusCopy.textContent = state.winner === "blue" ? "紅棋已無法繼續應戰，這局由你拿下。" : "藍棋已無法繼續移動，紅棋贏得這局。";
      return;
    }
    if (state.turn === "red") {
      turnLabel.textContent = "紅棋思考中";
      statusTitle.textContent = "電腦正在走棋";
      statusCopy.textContent = state.chain ? "紅棋正在自動完成連吃。" : "紅棋正在選擇下一步。";
      return;
    }
    turnLabel.textContent = "藍棋回合";
    if (state.chain) {
      statusTitle.textContent = "連吃機會";
      statusCopy.textContent = "滑鼠或觸控請用鎖定棋子；鍵盤仍可改選其他藍棋。點擊遠處空格可結束連吃。";
    } else {
      statusTitle.textContent = "輪到你走棋";
      statusCopy.textContent = message || "選擇一枚藍棋，再點擊斜向的空格。";
    }
  }

  function render(message) {
    renderBoard();
    updateStatus(message);
  }

  function finishIfNeeded() {
    const state = stateRef.current;
    Engine.detectGameOver(state);
    if (state.winner) {
      cancelBot();
      render();
      const blueWon = state.winner === "blue";
      $("end-title").textContent = blueWon ? "藍棋勝出" : "紅棋勝出";
      $("end-copy").textContent = blueWon
        ? "紅棋已經沒有棋子或合法步數。棋盤上的最後一手，屬於你。"
        : "藍棋已經沒有棋子或合法步數。紅棋守住了棋局。";
      $("end-steps").textContent = String(state.blueSteps);
      window.setTimeout(() => showView("end"), 380);
      return true;
    }
    return false;
  }

  function cancelBot() {
    botTurnToken += 1;
    if (botTimer.current !== null) {
      window.clearTimeout(botTimer.current);
      botTimer.current = null;
    }
  }

  function scheduleRedTurn() {
    const state = stateRef.current;
    if (!state || state.turn !== "red" || state.winner) return;
    const token = ++botTurnToken;
    botTimer.current = window.setTimeout(() => {
      if (token !== botTurnToken || !stateRef.current || stateRef.current.turn !== "red") return;
      const move = Engine.chooseRedMove(stateRef.current);
      if (!move) {
        Engine.detectGameOver(stateRef.current);
        if (!stateRef.current.winner) {
          stateRef.current.winner = "blue";
          stateRef.current.endReason = "red";
        }
        finishIfNeeded();
        return;
      }
      const result = Engine.playRedMove(stateRef.current, move);
      setNotice(result.message, "good");
      render();
      if (result.winner) {
        finishIfNeeded();
      } else if (stateRef.current.turn === "red" && stateRef.current.chain) {
        scheduleRedTurn();
      } else {
        finishIfNeeded();
      }
    }, 600);
  }

  function processResult(result) {
    if (!result) return;
    setNotice(result.message || "", result.changed ? "good" : "error");
    render(result.message);
    if (result.winner) {
      finishIfNeeded();
      return;
    }
    if (finishIfNeeded()) return;
    const state = stateRef.current;
    if (state.turn === "red") scheduleRedTurn();
  }

  function onSquareClick(event) {
    const square = event.currentTarget;
    const row = Number(square.dataset.row);
    const col = Number(square.dataset.col);
    const state = stateRef.current;
    if (!state || state.turn !== "blue" || state.winner) return;
    const result = Engine.applyBlueDestination(state, row, col);
    processResult(result);
  }

  function startGame() {
    cancelBot();
    stateRef.current = Engine.createInitialState();
    setupBlueKeyLookup(stateRef.current);
    setNotice("棋局開始。藍棋先行。", "good");
    showView("game");
    render("選擇一枚藍棋，再點擊斜向的空格。");
    boardElement.focus({ preventScroll: true });
  }

  function returnToSetup() {
    cancelBot();
    stateRef.current = null;
    showView("setup");
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
    const state = stateRef.current;
    if (!state || gameView.hidden || state.winner) return;
    const key = String(event.key).toLowerCase();
    if (Engine.BLUE_KEYS.includes(key)) {
      event.preventDefault();
      processResult(Engine.selectBlueByKey(state, key));
    } else if (["1", "2", "4", "5"].includes(key)) {
      event.preventDefault();
      processResult(Engine.moveBlueByDirection(state, key));
    }
  }

  $("start-game").addEventListener("click", startGame);
  $("restart-game").addEventListener("click", startGame);
  $("back-to-setup").addEventListener("click", returnToSetup);
  $("play-again").addEventListener("click", startGame);
  $("end-back").addEventListener("click", returnToSetup);
  window.addEventListener("keydown", onKeyDown);
})();
