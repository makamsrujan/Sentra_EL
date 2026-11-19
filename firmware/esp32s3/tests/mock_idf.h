#ifndef SENTRA_MOCK_IDF_H
#define SENTRA_MOCK_IDF_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef int i2c_port_t;
typedef int esp_err_t;
typedef int gpio_num_t;
typedef int gpio_mode_t;
typedef int gpio_pullup_t;
typedef int gpio_pulldown_t;
typedef int gpio_int_type_t;

#ifndef I2C_NUM_0
#define I2C_NUM_0 0
#endif

#ifndef ESP_OK
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_INVALID_SIZE 0x104
#define ESP_ERR_NOT_FOUND 0x105
#define ESP_ERR_NOT_SUPPORTED 0x106
#define ESP_ERR_TIMEOUT 0x107
#define ESP_ERR_INVALID_RESPONSE 0x108
#endif

#define GPIO_MODE_OUTPUT 2
#define GPIO_PULLUP_DISABLE 0
#define GPIO_PULLDOWN_DISABLE 0
#define GPIO_INTR_DISABLE 0

typedef struct {
    uint64_t pin_bit_mask;
    gpio_mode_t mode;
    gpio_pullup_t pull_up_en;
    gpio_pulldown_t pull_down_en;
    gpio_int_type_t intr_type;
} gpio_config_t;

#define pdMS_TO_TICKS(ms) (ms)
#define ESP_LOGI(tag, fmt, ...) ((void)tag)
#define ESP_LOGW(tag, fmt, ...) ((void)tag)
#define ESP_LOGE(tag, fmt, ...) ((void)tag)

int64_t esp_timer_get_time(void);
void vTaskDelay(uint32_t ticks);
esp_err_t gpio_config(const gpio_config_t *pGPIOConfig);
esp_err_t gpio_set_level(gpio_num_t gpio_num, uint32_t level);

esp_err_t sentra_i2c_write_reg8(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint8_t value);
esp_err_t sentra_i2c_read_regs(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint8_t *out_buf, size_t len);
esp_err_t sentra_i2c_read_reg16(i2c_port_t bus, uint8_t dev_addr, uint8_t reg, uint16_t *out_val_be);

#endif /* SENTRA_MOCK_IDF_H */
