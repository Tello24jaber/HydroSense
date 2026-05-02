ESP32 3V3 → red + rail
ESP32 GND → blue - rail

CD4067 pin 24 → red + rail
CD4067 pin 12 → blue - rail
CD4067 pin 15 → blue - rail
CD4067 pin 1  → ESP32 G34
CD4067 pin 10 → ESP32 G23
CD4067 pin 11 → ESP32 G18
CD4067 pin 14 → ESP32 G19
CD4067 pin 13 → ESP32 G25

SW-420 #1 VCC → red + rail
SW-420 #1 GND → blue - rail
SW-420 #1 DO  → CD4067 pin 9

SW-420 #2 VCC → red + rail
SW-420 #2 GND → blue - rail
SW-420 #2 DO  → CD4067 pin 8

ADXL345 #1 VCC → red + rail
ADXL345 #1 GND → blue - rail
ADXL345 #1 SDA → ESP32 G21
ADXL345 #1 SCL → ESP32 G22
ADXL345 #1 CS  → red + rail
ADXL345 #1 SDO → blue - rail

ADXL345 #2 VCC → red + rail
ADXL345 #2 GND → blue - rail
ADXL345 #2 SDA → ESP32 G21
ADXL345 #2 SCL → ESP32 G22
ADXL345 #2 CS  → red + rail
ADXL345 #2 SDO → red + rail