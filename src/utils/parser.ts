import { ParsedVoiceIntent } from '../types/sentra';

export function parseVoiceIntent(query: string): ParsedVoiceIntent {
  const clean =
    query
      .trim()
      .replace(/^(?:hey|okay|ok)\s*,?\s*(?:sentra|centra|sendra)\b[\s,.:;!?-]*/i, '')
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

  // 2. Obstacles, Overhead Hanging Hazards, Road Crossing, Traffic Signals & Approaching Vehicles/EVs
  // Must come BEFORE generic "find ..." so "finding obstacles" routes to scene_analysis
  if (
    /\b(obstacl\w*|obstucl\w*|hazards?|blocking my path|path is clear|is my way clear|is it safe to walk|anything in my way|is the path clear|clear to step|in my path|watch out|check ahead|hanging|overhead|above my head|head level|cross(?:ing)? (?:the )?road|traffic (?:light|signal)|pedestrian signal|signal color|any (?:cars?|vehicles?|bikes?|autos?|traffic|ev|electric vehicles?)|bus coming|approaching)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'describe',
      operation: 'scene_analysis',
      query: clean,
    };
  }

  // 3. Walk Assistant / Navigation Guidance (e.g. "Help me to walk near door", "Guide me to the exit")
  const navMatch = lower.match(
    /(?:(?:help me (?:to )?)?walk(?: me)?\s+(?:near|to|toward|towards)|guide me\s+(?:near|towards|toward|to)|navigate\s+(?:near|to)|lead me\s+(?:near|to)|take me\s+(?:near|to))\s+(?:the |a |an |my )?(.+)/i
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

  // General walk assistance without a named destination (e.g. "Help me walk", "Walk assistant")
  if (/\b(help me (?:to )?walk|walk assist\w*|walking assist\w*|assist me walking)\b/i.test(lower)) {
    return {
      mode: 'describe',
      operation: 'scene_analysis',
      query: clean,
    };
  }

  // 4. Memory recall ("Where did I leave...", "Did you remember...")
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

  // 5. Read Signage, Bus Numbers/Stops, Shop Names, Supermarket Products/Expiry/MRP & QR Codes
  if (
    /\b(read|what does (?:it|this) say|text|words|labels?|signs?|signboard|receipt|document|transcribe|which bus|bus number|bus stop|stop name|what shop|shop name|store name|what product|identify (?:this )?product|packet|bottle label|expiry|price|mrp|qr code|barcode)\b/i.test(
      lower
    )
  ) {
    return {
      mode: 'read',
      operation: 'scene_analysis',
      query: clean,
    };
  }

  // 6. Active Object Finder (e.g. "Find the water bottle", "Where is my phone?")
  const findMatch = lower.match(
    /(?:(?:can you |please |help me (?:to )?)?(?:find|finding|locate|look for|search for|spot|show me)|where (?:is|are))\s+(?:my |the |a |an )?(.+)/i
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

  // 8. Describe Surroundings / Scene Recognition
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
