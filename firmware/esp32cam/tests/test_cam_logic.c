/**
 * @file test_cam_logic.c
 * @brief Native host unit tests for SENTRA ESP32-CAM sender helper logic.
 */

#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "ai_thinker_pins.h"
#include "cam_sender_logic.h"

static void test_boot_session_format(void) {
    char a[32] = {0};
    char b[32] = {0};
    int len_a = sentra_cam_format_boot_session(0x1234abcdU, 0x0000cafeU, a, sizeof(a));
    int len_b = sentra_cam_format_boot_session(0x98765432U, 0xdeadbeefU, b, sizeof(b));
    assert(len_a > 0);
    assert(len_b > 0);
    assert(strcmp(a, "cam-1234abcd-0000cafe") == 0);
    assert(strcmp(b, "cam-98765432-deadbeef") == 0);
    assert(strcmp(a, b) != 0);
    /* Too-small buffer must fail cleanly */
    assert(sentra_cam_format_boot_session(1U, 2U, a, 8) < 0);
}

static void test_frame_url_builder(void) {
    char url[128] = {0};
    assert(sentra_cam_build_frame_url("http://192.168.1.50:3000/", "ESP32-CAM-SENTRA-001", url, sizeof(url)) > 0);
    assert(strcmp(url, "http://192.168.1.50:3000/api/device/frame?deviceId=ESP32-CAM-SENTRA-001") == 0);

    assert(sentra_cam_build_frame_url("https://sentra.example.com///", "CAM-02", url, sizeof(url)) > 0);
    assert(strcmp(url, "https://sentra.example.com/api/device/frame?deviceId=CAM-02") == 0);

    /* Reject null/empty inputs and overflow */
    assert(sentra_cam_build_frame_url("", "CAM-02", url, sizeof(url)) < 0);
    assert(sentra_cam_build_frame_url("http://host", "", url, sizeof(url)) < 0);
    assert(sentra_cam_build_frame_url("http://host", "CAM-02", url, 10) < 0);
}

static void test_jpeg_validation(void) {
    const uint8_t valid_jpeg[] = { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0xFF, 0xD9 };
    const uint8_t bad_soi[]    = { 0x00, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0xFF, 0xD9 };
    const uint8_t bad_eoi[]    = { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0xFF, 0x00 };
    const uint8_t too_short[]  = { 0xFF, 0xD8, 0xFF, 0xD9 };

    assert(sentra_cam_validate_jpeg(valid_jpeg, sizeof(valid_jpeg)) == true);
    assert(sentra_cam_validate_jpeg(bad_soi, sizeof(bad_soi)) == false);
    assert(sentra_cam_validate_jpeg(bad_eoi, sizeof(bad_eoi)) == false);
    assert(sentra_cam_validate_jpeg(too_short, sizeof(too_short)) == false);
    assert(sentra_cam_validate_jpeg(NULL, 100) == false);
}

static void test_bounded_retry_backoff(void) {
    uint32_t d0 = sentra_cam_retry_delay_ms(0);
    uint32_t d1 = sentra_cam_retry_delay_ms(1);
    uint32_t d2 = sentra_cam_retry_delay_ms(2);
    uint32_t d_hi = sentra_cam_retry_delay_ms(20);
    assert(d0 >= 200);
    assert(d1 >= d0);
    assert(d2 >= d1);
    assert(d_hi <= 10000);
}

static void test_ai_thinker_candidate_pins(void) {
    assert(CAM_PIN_PWDN == 32);
    assert(CAM_PIN_XCLK == 0);
    assert(CAM_PIN_SIOD == 26);
    assert(CAM_PIN_SIOC == 27);
    assert(CAM_PIN_PCLK == 22);
}

int main(void) {
    test_boot_session_format();
    test_frame_url_builder();
    test_jpeg_validation();
    test_bounded_retry_backoff();
    test_ai_thinker_candidate_pins();
    printf("PASS: all 5 ESP32-CAM sender host unit tests passed.\n");
    return 0;
}
