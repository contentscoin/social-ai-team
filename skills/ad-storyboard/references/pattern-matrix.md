# Pattern Matrix

## Corpus

- Total normalized references: 2,052
- Award references: 1,890
- Dolphiners official YouTube references: 162
- Production-ready gated examples: 345
- Top patterns: delightful_twist_demo, surreal_product_metaphor, cultural_participation, proof_experiment, story_first_branded_film, problem_relief

## Pattern Selection

| Condition | Pattern | Use when | Guardrail |
| --- | --- | --- | --- |
| Product has proof, comparison, result, expert evidence, or substantiated ingredient story | proof_experiment | Claim must be visible and credible | Do not invent proof |
| Audience has daily friction but proof is limited | problem_relief | Product fits a relatable routine or pain | Use safe context language |
| Product can be the object that makes an impossible moment possible | absurd_product_demo | Product can cause the joke or twist | Product must drive the twist |
| Brand can carry entertainment-first narrative | story_first_branded_film | Long-form, celebrity, craft, or narrative-first content | Brand memory must arrive before final packshot |
| Brand can parody a known genre | genre_parody_longform | Genre grammar itself is entertaining | Avoid copying scenes, actors, lines |
| Campaign can join a ritual, fandom, challenge, or social behavior | cultural_participation | Audience behavior can create spread | Avoid unsafe or exclusionary prompts |
| Product is visual, sensory, packaged, or object-led | static_product_hero or surreal_product_metaphor | Fast product memory matters | Avoid detached logo-only fun |
| Product is a tool, app, or workflow | b2b_authority_relief or branded_utility | Product creates capability or relief | Require concrete use context |
| Korean Dolphiners-style branded content is desired | meta_ad_about_ad, meme_collision, absurd_product_demo, genre_parody_longform | Start as content, resolve as brand memory | Do not let entertainment outshine product |

## Joy Mechanisms

- surprise: unexpected visual or behavior
- humor: joke linked to product use or benefit
- relief: friction decreases
- participation: viewer joins a game, challenge, or ritual
- identity: viewer recognizes self or aspirational self
- wonder: craft, beauty, scale, or sensory richness
- mastery: product makes the user feel capable

## Product Emphasis

- early_product_cue
- product_in_use
- product_as_prop
- branded_utility
- branded_worldbuilding
- product_transformation
- proof_overlay
- late_brand_reveal

Use `late_brand_reveal` carefully. If the product appears only at the end and the fun works without it, rewrite.

## Pattern Misuse Guard

Do not choose `proof_experiment` when there is no proof asset and no claim that needs substantiation. For low-risk sensory products such as beverages, snacks, fashion objects, venues, or entertainment offers, prefer `delightful_twist_demo`, `problem_relief`, `surreal_product_metaphor`, or `cultural_participation` depending on the joy target.

For sparkling water or beverage reset concepts, the default pattern should be `delightful_twist_demo + problem_relief`: the drink creates a small sensory reset, surprising object behavior, or social rhythm shift. Use `proof_experiment` only if the brief supplies a test, ingredient claim, comparison, or metric.
