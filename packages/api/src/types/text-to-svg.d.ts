declare module "text-to-svg" {
  export type TextToSVGOptions = {
    x?: number;
    y?: number;
    fontSize?: number;
    kerning?: boolean;
    letterSpacing?: number;
    tracking?: number;
    anchor?: string;
    attributes?: Record<string, string>;
  };

  export type TextMetrics = {
    x: number;
    y: number;
    baseline: number;
    width: number;
    height: number;
    ascender: number;
    descender: number;
  };

  class TextToSVG {
    static loadSync(fontPath?: string): TextToSVG;
    static load(
      fontPath: string,
      callback: (error: Error | null, instance?: TextToSVG) => void,
    ): void;
    getD(text: string, options?: TextToSVGOptions): string;
    getPath(text: string, options?: TextToSVGOptions): string;
    getSVG(text: string, options?: TextToSVGOptions): string;
    getMetrics(text: string, options?: TextToSVGOptions): TextMetrics;
  }

  export default TextToSVG;
}
