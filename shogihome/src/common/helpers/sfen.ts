// SFEN の先後を反転させる。
// 正規化された SFEN にしか使用できない。
export function flippedSFEN(sfen: string): string {
  const sections = sfen.split(" ");

  // 盤
  const board = [] as string[];
  for (let i = sections[0].length - 1; i >= 0; i--) {
    let c = sections[0][i];
    c = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
    if (i > 0 && sections[0][i - 1] === "+") {
      board.push("+");
      i--;
    }
    board.push(c);
  }
  sections[0] = board.join("");

  // 手番
  sections[1] = sections[1] === "b" ? "w" : "b";

  // 持ち駒
  let blackHandLength = sections[2].length;
  for (; blackHandLength >= 1; blackHandLength--) {
    const char = sections[2][blackHandLength - 1];
    if (char !== char.toLowerCase()) {
      break;
    }
  }
  sections[2] =
    sections[2].slice(blackHandLength).toUpperCase() +
    sections[2].slice(0, blackHandLength).toLowerCase();

  return sections.join(" ");
}

const usiFlipMap: { [char: string]: string } = {
  "1": "9",
  "2": "8",
  "3": "7",
  "4": "6",
  "5": "5",
  "6": "4",
  "7": "3",
  "8": "2",
  "9": "1",
  a: "i",
  b: "h",
  c: "g",
  d: "f",
  e: "e",
  f: "d",
  g: "c",
  h: "b",
  i: "a",
};

export function flippedUSIMove(usi: string): string {
  let flipped = "";
  for (let i = 0; i < usi.length; i++) {
    flipped += usiFlipMap[usi[i]] || usi[i];
  }
  return flipped;
}
