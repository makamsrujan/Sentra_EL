/**
 * @file ai_thinker_pins.h
 * @brief First-candidate AI-Thinker ESP32-CAM (ESP-32S) OV2640 pin profile.
 *
 * IMPORTANT: Treated as the FIRST CANDIDATE pin profile for AI-Thinker-style
 * ESP-32S camera boards, NOT a claim that your specific clone has been bench-verified.
 * Keep the OV2640 ribbon strictly on the ESP32-CAM board; never wire DVP lines to ESP32-S3.
 */

#ifndef SENTRA_AI_THINKER_PINS_H
#define SENTRA_AI_THINKER_PINS_H

#define CAM_PIN_PWDN    32
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK    0
#define CAM_PIN_SIOD    26
#define CAM_PIN_SIOC    27

#define CAM_PIN_D7      35  /* Y9 */
#define CAM_PIN_D6      34  /* Y8 */
#define CAM_PIN_D5      39  /* Y7 */
#define CAM_PIN_D4      36  /* Y6 */
#define CAM_PIN_D3      21  /* Y5 */
#define CAM_PIN_D2      19  /* Y4 */
#define CAM_PIN_D1      18  /* Y3 */
#define CAM_PIN_D0      5   /* Y2 */

#define CAM_PIN_VSYNC   25
#define CAM_PIN_HREF    23
#define CAM_PIN_PCLK    22

#define CAM_PIN_FLASH_LED 4

#endif /* SENTRA_AI_THINKER_PINS_H */
