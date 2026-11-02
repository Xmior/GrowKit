// Growtopia text: ` plus a code changes colour, `` resets, <CR> breaks the line. Colours come from the game's font file.
const GameText = {
  COLORS: {"0": "#ffffff", "1": "#adf4ff", "2": "#49fc00", "3": "#bfdaff", "4": "#ff271d", "5": "#ebb7ff", "6": "#ffca6f", "7": "#e6e6e6", "8": "#ff9445", "9": "#ffee7d", "!": "#d1fff9", "@": "#ffcdc9", "#": "#ff8ff3", "$": "#fffcc5", "^": "#b5ff97", "&": "#feebff", "w": "#ffffff", "o": "#fce6ba", "b": "#000000", "p": "#ffdff1", "q": "#0c60a4", "e": "#19b9ff", "r": "#6fd357", "t": "#2f830d", "a": "#515151", "s": "#9e9e9e", "c": "#50ffff"},

  render(target, text) {
    target.replaceChildren();
    let color = null;
    let run = "";
    const flush = () => {
      if (!run) return;
      const span = document.createElement("span");
      span.textContent = run;
      if (color) span.style.color = color;
      target.appendChild(span);
      run = "";
    };
    const source = text.replaceAll("<CR>", "\n");
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "`" && i + 1 < source.length) {
        flush();
        const code = source[++i];
        color = code === "`" ? null : this.COLORS[code] || color;
      } else {
        run += source[i];
      }
    }
    flush();
  },
};
