import type { ForwardStage, StageId } from '../../model/forwardPass';
import type { GpuSceneId } from '../gpu';
import type { ModelProfile } from '../../types';

// What each forward-pass stage is, in plain words, for Act 2. Numbers are
// filled in from the model at render time; nothing here is a measurement.

/** What limits a stage, in the words every Act 2 view uses. */
export const LIMIT_LABEL: Record<ForwardStage['limit'], string> = { math: 'Math', memory: 'Reading memory', host: 'The host link' };

export interface HardwareLink {
  /** Act 1 scene and part to open, e.g. package + hbm. */
  scene: GpuSceneId;
  part: string;
  label: string;
}

export interface StageCopy {
  title: string;
  lead: (model: ModelProfile) => string;
  growsWith: string[];
  overflow: (facts: StageFacts) => string;
  doesTheWork: HardwareLink[];
  note?: string;
}

export interface StageFacts {
  model: ModelProfile;
  kvPerToken: string;
  tableSize: string;
  mlpShareOfLayer: number;
  unembedShareOfModel: number;
}

export const STAGE_COPY: Record<StageId, StageCopy> = {
  tokenize: {
    title: 'Text → tokens',
    lead: () => 'The serving process on the CPU splits the text into tokens from a fixed vocabulary and turns each into an integer ID. Only those IDs cross to the GPU.',
    growsWith: ['prompt length'],
    overflow: () => 'Never on the GPU: the IDs are a few bytes per token. Very long prompts cost CPU time to tokenize, not GPU time.',
    doesTheWork: [
      { scene: 'server', part: 'host', label: 'CPU and its memory' },
      { scene: 'server', part: 'pcie', label: 'PCIe host link' },
    ],
  },
  embed: {
    title: 'Embed',
    lead: (model) => `Each token ID picks one row from the embedding table: a vector of ${model.hiddenSize.toLocaleString()} numbers that the rest of the model works on.`,
    growsWith: ['tokens in this pass'],
    overflow: (facts) => `Rarely. The table (${facts.tableSize}) must sit in GPU memory, but each token reads only its own row, so almost no bytes move.`,
    doesTheWork: [{ scene: 'package', part: 'hbm', label: 'Memory stacks (HBM)' }],
  },
  attention: {
    title: 'Attention',
    lead: () => 'Each token looks back at every earlier token. It projects itself into a query, a key, and a value; keys and values are saved in the KV cache so later tokens can look back without recomputing them. The layer’s norm and residual add are folded in.',
    growsWith: ['context length', 'concurrent users'],
    overflow: (facts) => `The KV cache: ${facts.kvPerToken} per token, per user. It fills GPU memory and is re-read on every step. In the first pass, the scores also grow with the square of the prompt’s length, so long prompts pile up math too.`,
    doesTheWork: [
      { scene: 'package', part: 'hbm', label: 'Memory stacks (HBM): the KV cache' },
      { scene: 'unit', part: 'matrix', label: 'Matrix units' },
      { scene: 'unit', part: 'smem', label: 'Scratchpad: fused scores stay here' },
    ],
    note: 'The softmax here runs over context length, inside every layer. It is not the vocabulary softmax at the end of the pass.',
  },
  mlp: {
    title: 'MLP (feed-forward)',
    lead: (model) => `Each token passes on its own through a wide two-layer network: expand from ${model.hiddenSize.toLocaleString()} to ${model.intermediateSize.toLocaleString()} channels, gate, and contract back. The layer’s norm and residual add are folded in.`,
    growsWith: ['tokens in this pass (not context length)'],
    overflow: (facts) => `Weights: about ${Math.round(facts.mlpShareOfLayer * 100)}% of each layer’s weights live here, and every generated token reads all of them. Limited by math in the first pass, by memory in every pass after.`,
    doesTheWork: [
      { scene: 'package', part: 'hbm', label: 'Memory stacks (HBM): the weights' },
      { scene: 'unit', part: 'matrix', label: 'Matrix units' },
    ],
    note: 'Mixture-of-experts models replace this block with many smaller experts, each token using only a few (Act 3).',
  },
  unembed: {
    title: 'Un-embed (LM head)',
    lead: (model) => `The final hidden state is multiplied by a ${model.vocabSize.toLocaleString()}-row matrix, giving one score (a logit) per vocabulary entry. Only the newest position needs it.`,
    growsWith: ['vocabulary size', 'concurrent users'],
    overflow: (facts) => `One ${facts.tableSize} matrix read on every step: about ${Math.round(facts.unembedShareOfModel * 100)}% of the model here, and a larger share for small models with big vocabularies.`,
    doesTheWork: [
      { scene: 'package', part: 'hbm', label: 'Memory stacks (HBM)' },
      { scene: 'unit', part: 'matrix', label: 'Matrix units' },
    ],
  },
  sample: {
    title: 'Softmax and sampling',
    lead: (model) => `Turn ${model.vocabSize.toLocaleString()} logits into probabilities with a softmax over the whole vocabulary, trim them with temperature, top-k, and top-p, then pick one token ID per user.`,
    growsWith: ['vocabulary size', 'concurrent users'],
    overflow: () => 'Rarely a bottleneck: a little math over one vector per user.',
    doesTheWork: [{ scene: 'unit', part: 'lanes', label: 'Vector lanes' }],
  },
  detokenize: {
    title: 'Token → text',
    lead: () => 'The chosen token ID is copied back to the CPU, turned into text, and streamed to the user. Generation then loops back to Embed with one new token per user.',
    growsWith: ['concurrent users'],
    overflow: () => 'The bytes are tiny, but it is a sync point on every token: the next step cannot be scheduled until the CPU knows which token was chosen.',
    doesTheWork: [
      { scene: 'server', part: 'pcie', label: 'PCIe host link' },
      { scene: 'server', part: 'host', label: 'CPU and its memory' },
    ],
  },
};
