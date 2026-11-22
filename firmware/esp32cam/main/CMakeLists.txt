idf_component_register(
    SRCS
        "main.c"
        "cam_sender_logic.c"
    INCLUDE_DIRS
        "."
    PRIV_REQUIRES esp_psram
    REQUIRES
        esp_wifi
        esp_event
        esp_netif
        esp_http_client
        esp_timer
        nvs_flash
        driver
        mbedtls
        esp32-camera
)
