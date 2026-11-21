idf_component_register(
    SRCS
        "../src/main.c"
        "../src/i2c_bus.c"
        "../src/sentra_nvs_config.c"
        "../src/vl53l0x.c"
        "../src/vl53l5cx_optional.c"
        "../src/mpu6050.c"
        "../src/wm8960.c"
        "../src/i2s_audio.c"
        "../src/audio_http.c"
        "../src/local_alerts.c"
        "../src/obstacle_awareness.c"
        "../src/wifi_transport.c"
        "../src/camera_driver.c"
        "../src/battery_adc.c"
        "../src/device_telemetry.c"
    INCLUDE_DIRS "../include"
    REQUIRES driver esp_adc esp_http_client json nvs_flash mbedtls
             esp_wifi esp_event esp_netif esp_timer esp_psram esp32-camera
)
