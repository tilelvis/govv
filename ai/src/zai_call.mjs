/**
 * KE GovVault — Node.js helper to call GLM via z-ai-web-dev-sdk.
 * Used by Python scripts (ai/src/extract_entities.py) via subprocess.
 *
 * Input (stdin): JSON { system, user, temperature?, max_tokens? }
 * Output (stdout): JSON { response, model, tokens_used, error? }
 */
import { ZAI } from 'z-ai-web-dev-sdk';

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const { system, user, temperature = 0.7, max_tokens = 800 } = JSON.parse(input);

  try {
    const zai = new ZAI();
    const result = await zai.chat.completions.create({
      model: 'glm-4-flash',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens,
    });

    const choice = result.choices?.[0];
    const response = choice?.message?.content || '';
    const model = result.model || '';

    // Estimate tokens (rough: ~4 chars per token)
    const tokens_used = result.usage?.total_tokens || Math.ceil((system.length + user.length + response.length) / 4);

    process.stdout.write(JSON.stringify({ response, model, tokens_used }));
  } catch (err: any) {
    process.stdout.write(JSON.stringify({ response: '', model: '', tokens_used: 0, error: err.message || String(err) }));
  }
}

main();