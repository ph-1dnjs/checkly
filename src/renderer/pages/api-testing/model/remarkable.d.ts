declare module "remarkable" {
  export class Remarkable {
    constructor(options?: { html?: boolean; breaks?: boolean });
    render(source: string): string;
  }
}
