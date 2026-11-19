/**
 * @file obstacle_awareness.h
 * @brief Modular local obstacle-awareness state machine with hysteresis and alert suppression.
 *
 * Separates distance acquisition/evaluation from acoustic alert delivery.
 * Evaluates ONLY ONE forward-facing VL53L0X sensor. Does NOT claim cliff/drop-off
 * detection or certified autonomous navigation.
 */

#ifndef SENTRA_OBSTACLE_AWARENESS_H
#define SENTRA_OBSTACLE_AWARENESS_H

#include <stdbool.h>
#include <stdint.h>
#include "vl53l0x.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SENTRA_OBSTACLE_UNKNOWN = 0,
    SENTRA_OBSTACLE_NONE,
    SENTRA_OBSTACLE_CAUTION,
    SENTRA_OBSTACLE_CRITICAL
} sentra_obstacle_level_t;

typedef struct {
    uint16_t critical_cm;
    uint16_t caution_cm;
    uint16_t hysteresis_cm;
    uint32_t alert_cooldown_ms;
    uint8_t invalid_suppress_count;
} sentra_obstacle_config_t;

typedef struct {
    sentra_obstacle_level_t level;
    uint8_t consecutive_invalid;
    int64_t last_alert_ms;
    bool initialized;
} sentra_obstacle_tracker_t;

typedef struct {
    sentra_obstacle_level_t previous_level;
    sentra_obstacle_level_t current_level;
    bool level_changed;
    bool should_trigger_critical_alert;
    float evaluated_distance_cm;
} sentra_obstacle_decision_t;

void sentra_obstacle_tracker_init(sentra_obstacle_tracker_t *tracker);

sentra_obstacle_decision_t sentra_obstacle_evaluate(
    sentra_obstacle_tracker_t *tracker,
    const vl53l0x_reading_t *reading,
    bool sensor_ready,
    const sentra_obstacle_config_t *config,
    int64_t now_ms
);

const char *sentra_obstacle_level_to_string(sentra_obstacle_level_t level);

#ifdef __cplusplus
}
#endif

#endif /* SENTRA_OBSTACLE_AWARENESS_H */
