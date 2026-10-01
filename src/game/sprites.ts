import operatorSheetUrl from './assets/seymour-technician-sheet-v2.png';
import plantSheetUrl from './assets/seymour-plants-sheet.png';

export interface SpriteSheet {
  image: HTMLImageElement;
  ready: boolean;
  columns: number;
  rows: number;
  frameSize: number;
}

export interface GameSpriteAtlas {
  operator: SpriteSheet;
  plants: SpriteSheet;
}

function loadSheet(source: string, columns: number, rows: number): SpriteSheet {
  const sheet: SpriteSheet = { image: new Image(), ready: false, columns, rows, frameSize: 64 };
  sheet.image.decoding = 'async';
  sheet.image.addEventListener('load', () => { sheet.ready = true; }, { once: true });
  sheet.image.src = source;
  return sheet;
}

export function createGameSpriteAtlas(): GameSpriteAtlas {
  return {
    operator: loadSheet(operatorSheetUrl, 6, 4),
    plants: loadSheet(plantSheetUrl, 6, 3),
  };
}

export function drawSpriteFrame(
  context: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  column: number,
  row: number,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  if (!sheet.ready || column < 0 || column >= sheet.columns || row < 0 || row >= sheet.rows) return false;
  context.drawImage(
    sheet.image,
    column * sheet.frameSize,
    row * sheet.frameSize,
    sheet.frameSize,
    sheet.frameSize,
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height),
  );
  return true;
}
