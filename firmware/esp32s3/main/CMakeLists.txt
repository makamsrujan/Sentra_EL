idf_component_register(
    SRCS
        "../src/main.c"
        "../src/wm8960.c"
        "../src/i2s_audio.c"
        "../src/audio_http.c"
        "../src/local_alerts.c"
        "../src/wifi_transport.c"
        "../src/camera_driver.c"
        "../src/device_telemetry.c"
    INCLUDE_DIRS "../include"
    REQUIRES driver esp_http_client json nvs_flash mbedtls
             esp_wifi esp_event esp_netif esp_timer esp32-camera
)
