export interface TruncateConfig {
  contextChars: number;
  maxDisplayChars: number;
}

export function calculateDisplayText(
  text: string,
  searchTerm: string,
  config: TruncateConfig
): {
  displayText: string;
  showEllipsisStart: boolean;
  showEllipsisEnd: boolean;
} {
  const matchIndex = searchTerm
    ? text.toLowerCase().indexOf(searchTerm.toLowerCase())
    : -1;

  if (!searchTerm || matchIndex === -1) {
    return {
      displayText: text,
      showEllipsisStart: false,
      showEllipsisEnd: false,
    };
  }

  const start = Math.max(0, matchIndex - config.contextChars);
  let end = 0;
  if (start === 0) {
    const shouldDisplayCount = config.maxDisplayChars - matchIndex;
    end = Math.min(
      text.length,
      matchIndex + config.contextChars + shouldDisplayCount
    );
  } else {
    end = Math.min(text.length, matchIndex + config.contextChars);
  }

  return {
    displayText: text.slice(start, end),
    showEllipsisStart: matchIndex > config.contextChars,
    showEllipsisEnd: end < text.length,
  };
}
