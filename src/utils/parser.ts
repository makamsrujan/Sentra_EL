import { ParsedVoiceIntent } from '../types/sentra';

export function parseVoiceIntent(query: string): ParsedVoiceIntent {
  const clean = query
    .trim()
    .replace(/^(?:hey|okay|ok)\s*,?\s*(?:sentra|centra)\b[\s,.:;!?-]*/i, '')
    .trim() || query.trim();
  const lower = clean.toLowerCase();

  // 1. Device / Wearable / Battery status query (does not need camera)
  if (
    /\b(device status|wearable status|battery level|sensor status|is (?:the )?(?:wearable|esp32|headband) connected)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'ask',
      operation: 'device_status',
      query: clean,
    };
  }

  // 2. Memory recall ("Where did I leave...", "Did you remember...")
  const memoryRecallMatch = lower.match(
    /(?:where did i (?:last )?(?:keep|leave|put)|where was my|did you remember where (?:i kept|my))\s+(?:my |the |a |an )?(.+)/i
  );
  if (memoryRecallMatch && memoryRecallMatch[1]) {
    const rawTarget = memoryRecallMatch[1].replace(/[?.!]$/, '').trim();
    return {
      mode: 'find',
      operation: 'object_query',
      goal: rawTarget,
      query: clean,
    };
  }

  // 3. Active Object Search
  const findMatch = lower.match(
    /(?:(?:can you |please )?(?:find|locate|look for|search for|spot|show me)|where (?:is|are))\s+(?:my |the |a |an )?(.+)/i
  );
  if (findMatch && findMatch[1]) {
    const rawGoal = findMatch[1].replace(/[?.!]$/, '').trim();
    return {
      mode: 'find',
      operation: 'object_query',
      goal: rawGoal,
      query: clean,
    };
  }

  // 4. Navigation / Guidance
  const navMatch = lower.match(
    /(?:guide me (?:towards|to)|navigate to|lead me to|take me to|walk me to)\s+(?:the |a |an )?(.+)/i
  );
  if (navMatch && navMatch[1]) {
    const destination = navMatch[1].replace(/[?.!]$/, '').trim();
    return {
      mode: 'navigate',
      operation: 'object_query',
      goal: destination,
      query: clean,
    };
  }

  // 5. Pathway & Obstacle inspection
  if (
    /\b(blocking my path|path is clear|is my way clear|is it safe to walk|anything in my way|is the path clear|clear to step|obstacle ahead)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'describe',
      operation: 'scene_analysis',
      query: clean,
    };
  }

  // 6. Read Text
  if (
    /\b(read|what does (?:it|this) say|text|words|labels?|signs?|receipt|document|transcribe)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'read',
      operation: 'scene_analysis',
      query: clean,
    };
  }

  // 7. Remember / Save Spot
  if (
    /\b(remember|save this|note this|record this place|remember this spot|keep in mind)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'remember',
      operation: 'scene_analysis',
      query: clean,
    };
  }

  // 8. Describe Surroundings
  if (
    /\b(what is around|what'?s around|surroundings|what do you see|what is in front of me|where am i|scene|overview|describe|what is this)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'describe',
      operation: 'scene_analysis',
      query: clean,
    };
  }

  // 9. General conversational ask (does not require camera frame)
  return {
    mode: 'ask',
    operation: 'conversation',
    query: clean,
  };
}
