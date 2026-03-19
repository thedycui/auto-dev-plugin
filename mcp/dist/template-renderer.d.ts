/**
 * TemplateRenderer — reads prompt templates, injects checklists,
 * replaces variables, and returns the fully rendered prompt.
 */
import type { RenderOutput } from "./types.js";
export declare class TemplateRenderer {
    private readonly skillsDir;
    constructor(skillsDir: string);
    render(promptFile: string, variables: Record<string, string>, extraContext?: string): Promise<RenderOutput>;
}
