/**
 * Pipeline Module
 *
 * Exports pipeline orchestration components:
 * - Pipeline: Main orchestrator for processor chains
 * - PipelineSource: Entry point for frames
 * - PipelineSink: Exit point for frames
 */

export { Pipeline, type PipelineOptions } from "./pipeline";
export { PipelineSource, type PipelineSourceOptions, type UpstreamPushFrameCallback } from "./source";
export { PipelineSink, type PipelineSinkOptions, type DownstreamPushFrameCallback } from "./sink";
