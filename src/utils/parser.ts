import { ParsedVoiceIntent } from '../types/sentra';

export function parseVoiceIntent(query: string): ParsedVoiceIntent {
  const clean = query.trim();
  const lower = clean.toLowerCase();

  // 1. Where did I last keep / leave / put (Memory Recall)
  const memoryRecallMatch = lower.match(
    /(?:where did i (?:last )?(?:keep|leave|put)|where was my|did you remember where (?:i kept|my))\s+(?:my |the |a |an )?(.+)/i
  );
  if (memoryRecallMatch && memoryRecallMatch[1]) {
    const rawTarget = memoryRecallMatch[1].replace(/[?.!]$/, '').trim();
    return {
      mode: 'find',
      goal: rawTarget,
      query: clean,
    };
  }

  // 2. Active Object Search: "Where is my water bottle?", "Can you find my spectacles?", "Where is the door?"
  const findMatch = lower.match(
    /(?:(?:can you |please )?(?:find|locate|look for|search for|spot|show me)|where (?:is|are))\s+(?:my |the |a |an )?(.+)/i
  );
  if (findMatch && findMatch[1]) {
    const rawGoal = findMatch[1].replace(/[?.!]$/, '').trim();
    return {
      mode: 'find',
      goal: rawGoal,
      query: clean,
    };
  }

  // 3. Navigation / Guidance: "Guide me towards the kitchen", "Navigate to the front door"
  const navMatch = lower.match(
    /(?:guide me (?:towards|to)|navigate to|lead me to|take me to|walk me to)\s+(?:the |a |an )?(.+)/i
  );
  if (navMatch && navMatch[1]) {
    const destination = navMatch[1].replace(/[?.!]$/, '').trim();
    return {
      mode: 'navigate',
      goal: destination,
      query: clean,
    };
  }

  // 4. Pathway & Obstacle clearance check: "Is there anything blocking my path?", "Is the way clear?"
  if (
    /\b(blocking my path|path is clear|is my way clear|is it safe to walk|anything in my way|is the path clear|clear to step|obstacle ahead)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'describe',
      query: clean,
    };
  }

  // 5. Read Text: "Read this", "What does it say", "Read the label"
  if (
    /\b(read|what does (?:it|this) say|text|words|labels?|signs?|receipt|document|transcribe)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'read',
      query: clean,
    };
  }

  // 6. Remember / Note: "Remember where I kept this object", "Remember this location"
  if (
    /\b(remember|save this|note this|record this place|remember this spot|keep in mind)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'remember',
      query: clean,
    };
  }

  // 7. Describe Surroundings: "Hey SENTRA, what is around me?", "What is in front of me?", "What do you see?"
  if (
    /\b(what is around|what'?s around|surroundings|what do you see|what is in front of me|where am i|scene|overview|describe)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'describe',
      query: clean,
    };
  }

  // 8. General conversational ask / "What should I do next?"
  return {
    mode: 'ask',
    query: clean,
  };
}
