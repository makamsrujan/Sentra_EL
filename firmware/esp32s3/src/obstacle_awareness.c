/**
 * @file obstacle_awareness.c
 * @brief Modular local obstacle-awareness evaluator for single forward VL53L0X.
 */

#include "obstacle_awareness.h"
#include <string.h>

void sentra_obstacle_tracker_init(sentra_obstacle_tracker_t *tracker) {
    if (!tracker) return;
    memset(tracker, 0, sizeof(*tracker));
    tracker->level = SENTRA_OBSTACLE_UNKNOWN;
    tracker->last_alert_ms = -1000000LL;
    tracker->initialized = true;
}

const char *sentra_obstacle_level_to_string(sentra_obstacle_level_t level) {
    switch (level) {
        case SENTRA_OBSTACLE_NONE:     return "none_detected";
        case SENTRA_OBSTACLE_CAUTION:  return "caution";
        case SENTRA_OBSTACLE_CRITICAL: return "critical";
        case SENTRA_OBSTACLE_UNKNOWN:
        default:                       return "unknown";
    }
}

sentra_obstacle_decision_t sentra_obstacle_evaluate(
    sentra_obstacle_tracker_t *tracker,
    const vl53l0x_reading_t *reading,
    bool sensor_ready,
    const sentra_obstacle_config_t *config,
    int64_t now_ms
) {
    sentra_obstacle_decision_t out = {0};
    if (!tracker || !config) {
        out.current_level = SENTRA_OBSTACLE_UNKNOWN;
        return out;
    }
    if (!tracker->initialized) {
        sentra_obstacle_tracker_init(tracker);
    }

    out.previous_level = tracker->level;

    if (!sensor_ready) {
        tracker->consecutive_invalid = 0;
        tracker->level = SENTRA_OBSTACLE_UNKNOWN;
        out.current_level = tracker->level;
        out.level_changed = (out.previous_level != out.current_level);
        return out;
    }

    if (!reading || !reading->valid) {
        tracker->consecutive_invalid++;
        uint8_t limit = config->invalid_suppress_count > 0 ? config->invalid_suppress_count : 3;
        if (tracker->consecutive_invalid >= limit) {
            tracker->level = SENTRA_OBSTACLE_UNKNOWN;
        }
        out.current_level = tracker->level;
        out.level_changed = (out.previous_level != out.current_level);
        return out;
    }

    tracker->consecutive_invalid = 0;
    float d = reading->distance_cm;
    out.evaluated_distance_cm = d;

    float critical_enter = (float)(config->critical_cm >= 10 ? config->critical_cm : 45);
    float caution_enter = (float)(config->caution_cm > critical_enter ? config->caution_cm : (critical_enter + 20.0f));
    float hyst = (float)(config->hysteresis_cm > 0 ? config->hysteresis_cm : 10);

    float critical_exit = critical_enter + hyst;
    float caution_exit = caution_enter + hyst;
    if (caution_exit <= critical_exit) {
        caution_exit = critical_exit + 5.0f;
    }

    sentra_obstacle_level_t next = tracker->level;

    switch (tracker->level) {
        case SENTRA_OBSTACLE_CRITICAL:
            if (d >= caution_exit) {
                next = SENTRA_OBSTACLE_NONE;
            } else if (d >= critical_exit) {
                next = SENTRA_OBSTACLE_CAUTION;
            } else {
                next = SENTRA_OBSTACLE_CRITICAL;
            }
            break;

        case SENTRA_OBSTACLE_CAUTION:
            if (d <= critical_enter) {
                next = SENTRA_OBSTACLE_CRITICAL;
            } else if (d >= caution_exit) {
                next = SENTRA_OBSTACLE_NONE;
            } else {
                next = SENTRA_OBSTACLE_CAUTION;
            }
            break;

        case SENTRA_OBSTACLE_NONE:
        case SENTRA_OBSTACLE_UNKNOWN:
        default:
            if (d <= critical_enter) {
                next = SENTRA_OBSTACLE_CRITICAL;
            } else if (d <= caution_enter) {
                next = SENTRA_OBSTACLE_CAUTION;
            } else {
                next = SENTRA_OBSTACLE_NONE;
            }
            break;
    }

    tracker->level = next;
    out.current_level = next;
    out.level_changed = (out.previous_level != next);

    if (next == SENTRA_OBSTACLE_CRITICAL) {
        int64_t cooldown = (int64_t)(config->alert_cooldown_ms > 0 ? config->alert_cooldown_ms : 3000);
        if (out.previous_level != SENTRA_OBSTACLE_CRITICAL ||
            (now_ms - tracker->last_alert_ms) >= cooldown) {
            out.should_trigger_critical_alert = true;
            tracker->last_alert_ms = now_ms;
        }
    }

    return out;
}
