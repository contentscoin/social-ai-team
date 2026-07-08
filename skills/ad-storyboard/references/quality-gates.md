# Quality Gates

## Minimum Scores

- product_clarity >= 4
- brand_linkage >= 4
- attention >= 3
- action_clarity >= 3

## Product-Delight Gate

The product must cause, unlock, explain, intensify, or make memorable the fun. If the same scene works after removing the product, rewrite.

Hard fail:

- product is unclear
- product only appears as a detached final logo
- delight is unrelated to product
- proof is invented or misleading
- CTA asks for multiple actions
- prompt would clone a reference asset too closely
- `proof_experiment` selected without proof, comparison, metric, expert evidence, or claim need
- demo/proof and joy_payoff repeat the same scene function

## Claim Safety

For health, supplement, beauty efficacy, finance, insurance, medical, or safety-related products:

- Missing proof blocks unsupported claims, not ideation.
- Use routine, package memory, serving moment, habit cue, readiness, confidence, or product memory.
- Put proof needs in `required_inputs`.
- Do not claim cure, treatment, prevention, diagnosis, physical transformation, measurable outcome, testimonial, expert proof, or ingredient effect without supplied proof.

## Reference Distance

Every prompt must say:

- no source asset reuse
- no actor or celebrity recreation
- no exact line, title, dialogue, copy, logo, costume, layout, or art-direction copying
- no frame clone
- no private product or customer data in shared packs

## Korean Text Rendering

If the storyboard requires Korean on-screen text, keep text short and specify that final typography should be composited manually or rendered with a Korean-safe text system. Do not rely on image generation to render long Korean copy perfectly.
