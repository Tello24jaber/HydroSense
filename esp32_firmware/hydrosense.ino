/*
  HydroSense v2 — 50 Hz Continuous CSV Streaming for Real-Time AI Inference
  ===========================================================================
  Hardware:
    - 2× ADXL345 on shared I2C (SDA=G21, SCL=G22)
        #1 at 0x53 (SDO → GND)  — Building M
        #2 at 0x1D (SDO → 3V3)  — Building C
    - 2× SW-420 via CD4067 mux
        SW-420 #1 DO → channel 0 (CD4067 pin 9)  — Building M
        SW-420 #2 DO → channel 1 (CD4067 pin 8)  — Building C
        Common (pin 1) → G34  |  A(10)→G23  |  B(11)→G18
        C(14)→G19  |  D(13)→G25  |  INH(15)→GND

  Serial output (115200 baud, ~50 Hz):
    Header row printed once at boot, then one CSV row per loop:
    TIME,A1_X,A1_Y,A1_Z,A1_MAG,A2_X,A2_Y,A2_Z,A2_MAG,
    SW1,SW2,CH1_ACTIVE,CH2_ACTIVE,CH1_STATUS,CH2_STATUS

    CH_STATUS values: SLEEP | MONITORING | ACTIVITY_DETECTED
*/

#include <Wire.h>
#include <math.h>

// ── ADXL345 ──────────────────────────────────────────────────────────────────
#define ADXL1_ADDR    0x53
#define ADXL2_ADDR    0x1D
#define REG_DEVID     0x00
#define REG_BW_RATE   0x2C
#define REG_PWR_CTL   0x2D
#define REG_DATA_FMT  0x31
#define REG_DATAX0    0x32
#define ODR_400HZ     0x0C   // 400 Hz ODR, low-power off
#define FMT_FULLRES8G 0x0B   // full-resolution ±8 g
#define MG_PER_LSB    0.0039f

// ── CD4067 mux ───────────────────────────────────────────────────────────────
#define MUX_A    23
#define MUX_B    18
#define MUX_C    19
#define MUX_D    25
#define MUX_SIG  34   // GPIO34 = input-only; add 10 kΩ pull-up to 3V3
#define VIB_CH1   0   // SW-420 #1 → CD4067 channel 0
#define VIB_CH2   1   // SW-420 #2 → CD4067 channel 1

// ── Timing ───────────────────────────────────────────────────────────────────
#define WINDOW_MS     10000UL  // detection window after SW trigger (ms)
#define LOOP_DELAY_MS 20       // ~50 Hz output rate
#define ACTIVITY_THR  0.05f    // deviation from 1 g to call ACTIVITY_DETECTED

// ── State ────────────────────────────────────────────────────────────────────
unsigned long ch1End = 0;
unsigned long ch2End = 0;

// ── ADXL345 helpers ──────────────────────────────────────────────────────────
static void adxlWrite(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

static bool adxlInit(uint8_t addr) {
  Wire.beginTransmission(addr);
  if (Wire.endTransmission() != 0) return false;
  Wire.beginTransmission(addr);
  Wire.write(REG_DEVID);
  Wire.endTransmission(false);
  Wire.requestFrom(addr, (uint8_t)1);
  if (!Wire.available() || Wire.read() != 0xE5) return false;
  adxlWrite(addr, REG_BW_RATE,  ODR_400HZ);
  adxlWrite(addr, REG_DATA_FMT, FMT_FULLRES8G);
  adxlWrite(addr, REG_PWR_CTL,  0x08);   // measurement mode
  return true;
}

static void adxlRead(uint8_t addr,
                     float &ax, float &ay, float &az, float &mag) {
  Wire.beginTransmission(addr);
  Wire.write(REG_DATAX0);
  Wire.endTransmission(false);
  Wire.requestFrom(addr, (uint8_t)6);
  int16_t x = (int16_t)((uint8_t)Wire.read() | ((uint16_t)Wire.read() << 8));
  int16_t y = (int16_t)((uint8_t)Wire.read() | ((uint16_t)Wire.read() << 8));
  int16_t z = (int16_t)((uint8_t)Wire.read() | ((uint16_t)Wire.read() << 8));
  ax = x * MG_PER_LSB;
  ay = y * MG_PER_LSB;
  az = z * MG_PER_LSB;
  mag = sqrtf(ax*ax + ay*ay + az*az);
}

// ── CD4067 helpers ────────────────────────────────────────────────────────────
static void muxSelect(uint8_t ch) {
  digitalWrite(MUX_A, (ch >> 0) & 1);
  digitalWrite(MUX_B, (ch >> 1) & 1);
  digitalWrite(MUX_C, (ch >> 2) & 1);
  digitalWrite(MUX_D, (ch >> 3) & 1);
}

// 5-sample majority-vote debounce (LOW = SW-420 triggered)
static int readVib(uint8_t ch) {
  muxSelect(ch);
  delayMicroseconds(200);
  int cnt = 0;
  for (int i = 0; i < 5; i++) {
    if (digitalRead(MUX_SIG) == LOW) cnt++;
    delayMicroseconds(200);
  }
  return (cnt >= 3) ? 1 : 0;
}

// ── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  Wire.begin(21, 22);
  Wire.setClock(400000);

  pinMode(MUX_A, OUTPUT); pinMode(MUX_B, OUTPUT);
  pinMode(MUX_C, OUTPUT); pinMode(MUX_D, OUTPUT);
  muxSelect(0);
  pinMode(MUX_SIG, INPUT);

  bool ok1 = adxlInit(ADXL1_ADDR);
  bool ok2 = adxlInit(ADXL2_ADDR);
  Serial.println(ok1 ? "[INFO] ADXL345 #1 (0x53) OK" : "[WARN] ADXL345 #1 NOT FOUND");
  Serial.println(ok2 ? "[INFO] ADXL345 #2 (0x1D) OK" : "[WARN] ADXL345 #2 NOT FOUND");
  delay(100);

  Serial.println(
    "TIME,A1_X,A1_Y,A1_Z,A1_MAG,"
    "A2_X,A2_Y,A2_Z,A2_MAG,"
    "SW1,SW2,CH1_ACTIVE,CH2_ACTIVE,CH1_STATUS,CH2_STATUS"
  );
}

// ── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  float a1x, a1y, a1z, a1mag;
  float a2x, a2y, a2z, a2mag;
  adxlRead(ADXL1_ADDR, a1x, a1y, a1z, a1mag);
  adxlRead(ADXL2_ADDR, a2x, a2y, a2z, a2mag);

  int sw1 = readVib(VIB_CH1);
  int sw2 = readVib(VIB_CH2);

  if (sw1) ch1End = now + WINDOW_MS;
  if (sw2) ch2End = now + WINDOW_MS;

  bool ch1Active = (now < ch1End);
  bool ch2Active = (now < ch2End);

  const char* s1 = !ch1Active ? "SLEEP"
    : (fabsf(a1mag - 1.0f) > ACTIVITY_THR || sw1) ? "ACTIVITY_DETECTED"
    : "MONITORING";

  const char* s2 = !ch2Active ? "SLEEP"
    : (fabsf(a2mag - 1.0f) > ACTIVITY_THR || sw2) ? "ACTIVITY_DETECTED"
    : "MONITORING";

  // Print one CSV row
  Serial.print(now);          Serial.print(',');
  Serial.print(a1x, 6);       Serial.print(',');
  Serial.print(a1y, 6);       Serial.print(',');
  Serial.print(a1z, 6);       Serial.print(',');
  Serial.print(a1mag, 6);     Serial.print(',');
  Serial.print(a2x, 6);       Serial.print(',');
  Serial.print(a2y, 6);       Serial.print(',');
  Serial.print(a2z, 6);       Serial.print(',');
  Serial.print(a2mag, 6);     Serial.print(',');
  Serial.print(sw1);          Serial.print(',');
  Serial.print(sw2);          Serial.print(',');
  Serial.print(ch1Active ? 1 : 0); Serial.print(',');
  Serial.print(ch2Active ? 1 : 0); Serial.print(',');
  Serial.print(s1);           Serial.print(',');
  Serial.println(s2);

  delay(LOOP_DELAY_MS);
}
