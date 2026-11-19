/**
 * @file wm8960.c
 * @brief Waveshare WM8960 Audio Codec Driver Implementation
 */

#include "wm8960.h"
#include "sentra_config.h"
#include "i2c_bus.h"
#include "esp_log.h"
#include "driver/i2c.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "WM8960";

esp_err_t wm8960_write_reg(int i2c_num, uint8_t reg_addr, uint16_t reg_val) {
    uint8_t data[2];
    /* Byte 0: 7-bit register address + MSB of 9-bit data */
    data[0] = ((reg_addr & 0x7F) << 1) | ((reg_val >> 8) & 0x01);
    /* Byte 1: lower 8 bits of data */
    data[1] = (uint8_t)(reg_val & 0xFF);

    if (!sentra_i2c_bus_lock(200)) return ESP_ERR_TIMEOUT;

    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (WM8960_I2C_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write(cmd, data, 2, true);
    i2c_master_stop(cmd);

    esp_err_t ret = i2c_master_cmd_begin((i2c_port_t)i2c_num, cmd, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(cmd);
    sentra_i2c_bus_unlock();

    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "I2C write error reg 0x%02X val 0x%03X: %s", reg_addr, reg_val, esp_err_to_name(ret));
    }
    return ret;
}

esp_err_t wm8960_init(int i2c_num) {
    ESP_LOGI(TAG, "Initializing Waveshare WM8960 Audio Board (addr 0x%02X)...", WM8960_I2C_ADDR);

    // 1. Reset WM8960 to default state
    esp_err_t ret = wm8960_write_reg(i2c_num, WM8960_REG_RESET, 0x000);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "WM8960 not responding on I2C bus! Check 3.3V power, GND, SDA (GPIO 47), SCL (GPIO 48).");
        return ret;
    }
    vTaskDelay(pdMS_TO_TICKS(50));

    // 2. Power Management 1: VMIDSEL=50k, VREF=1, AINL=1, AINR=1, ADCL=1, ADCR=1, MICBIAS=1
    // Bit 8-7: VMIDSEL (01 = 50k for playback/record), Bit 6: VREF, Bit 5: AINL, Bit 4: AINR,
    // Bit 3: ADCL, Bit 2: ADCR, Bit 1: MICBIAS
    wm8960_write_reg(i2c_num, WM8960_REG_PWR_MGMT1, 0x0FE);

    // 3. Power Management 2: DACL=1, DACR=1, LOUT1=1, ROUT1=1 (Headphone outputs enabled)
    wm8960_write_reg(i2c_num, WM8960_REG_PWR_MGMT2, 0x1E0);

    // 4. Power Management 3: LMIC=1, RMIC=1, Left/Right Output Mixers enabled
    wm8960_write_reg(i2c_num, WM8960_REG_PWR_MGMT3, 0x03C);

    // 5. Clocking: SYSCLK from MCLK / PLL disabled for direct MCLK (CLKSEL=0)
    wm8960_write_reg(i2c_num, WM8960_REG_CLOCKING1, 0x000);

    // 6. Audio Interface: I2S format, 16-bit word length, Slave mode (ESP32 is I2S Master)
    // Bit 1-0: 10 (I2S mode), Bit 3-2: 00 (16-bit), Bit 6: MS=0 (Slave)
    wm8960_write_reg(i2c_num, WM8960_REG_AUDIO_INTERFACE1, 0x002);

    // 7. ADC & DAC Control 1: DAC soft unmute, no de-emphasis
    wm8960_write_reg(i2c_num, WM8960_REG_DAC_CONTROL1, 0x000);

    // 8. Output Mixer: Route Left DAC to Left Mixer and Right DAC to Right Mixer
    wm8960_write_reg(i2c_num, WM8960_REG_LEFT_OUT_MIX, 0x100);
    wm8960_write_reg(i2c_num, WM8960_REG_RIGHT_OUT_MIX, 0x100);

    // 9. Input PGA Configuration: Connect MIC1 (headset electret) to Left Input PGA
    // Set moderate input boost (+15 dB)
    wm8960_write_reg(i2c_num, 0x20, 0x038); // LMN1 to Left PGA
    wm8960_write_reg(i2c_num, WM8960_REG_LEFT_INPUT_VOL, 0x117); // Left PGA Volume (+12dB)
    wm8960_write_reg(i2c_num, WM8960_REG_RIGHT_INPUT_VOL, 0x117);

    // 10. Headphone Volume: Default to safe, comfortable assistive listening level (approx. 70%)
    wm8960_set_headphone_volume(i2c_num, 70);

    // 11. DAC Digital Volume: 0 dB
    wm8960_write_reg(i2c_num, WM8960_REG_LEFT_DAC_VOL, 0x1FF);
    wm8960_write_reg(i2c_num, WM8960_REG_RIGHT_DAC_VOL, 0x1FF);

    ESP_LOGI(TAG, "WM8960 Codec successfully initialized.");
    return ESP_OK;
}

esp_err_t wm8960_set_headphone_volume(int i2c_num, uint8_t volume_pct) {
    if (volume_pct > 100) volume_pct = 100;
    // WM8960 LOUT1/ROUT1 volume range: 0x30 (-30dB) to 0x7F (+6dB). 0x79 = 0dB.
    // Scale 0..100% to 0x30..0x79 (safe ceiling 0dB to prevent ear damage)
    uint8_t vol_val = 0x30 + (uint8_t)(((uint16_t)volume_pct * (0x79 - 0x30)) / 100);

    // Bit 8 (0x100) = Volume Update bit (updates L and R simultaneously)
    esp_err_t ret = wm8960_write_reg(i2c_num, WM8960_REG_LOUT1_VOL, vol_val | 0x100);
    if (ret == ESP_OK) {
        ret = wm8960_write_reg(i2c_num, WM8960_REG_ROUT1_VOL, vol_val | 0x100);
    }
    return ret;
}

esp_err_t wm8960_set_mic_gain(int i2c_num, uint8_t gain_pct) {
    if (gain_pct > 100) gain_pct = 100;
    // PGA volume: 0x00 to 0x3F (0 to +30 dB in 0.75 dB steps).
    uint8_t gain_val = (uint8_t)(((uint16_t)gain_pct * 0x3F) / 100);
    return wm8960_write_reg(i2c_num, WM8960_REG_LEFT_INPUT_VOL, gain_val | 0x100);
}

esp_err_t wm8960_set_dac_mute(int i2c_num, bool mute) {
    return wm8960_write_reg(i2c_num, WM8960_REG_DAC_CONTROL1, mute ? 0x008 : 0x000);
}
