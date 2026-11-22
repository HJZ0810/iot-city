/*
 * 板端关卡 board-b1-01「三灯点名」参考实现
 * ------------------------------------------------------------------
 * 学生要做的：把下面 setup 里三行 TODO 换成真正驱动 LED 的代码。
 * 其余（联网、上屏、证据上报）全部由 SDK 完成。
 */
#include <Arduino.h>

#include "hcp_sdk.h"

void setup() {
  HCP.begin();               // 联网 + 上屏 + 开始收题

  pinMode(HCP_LED1, OUTPUT); // GPIO4
  pinMode(HCP_LED2, OUTPUT); // GPIO5
  pinMode(HCP_LED3, OUTPUT); // GPIO6
  pinMode(HCP_LED4, OUTPUT); // GPIO7（本题必须保持熄灭）

  // 1) 让 1 号灯闪三下自检
  for (int i = 0; i < 3; i++) {
    digitalWrite(HCP_LED1, HIGH);
    delay(200);
    digitalWrite(HCP_LED1, LOW);
    delay(200);
  }

  // 2) 三灯常亮，四号灯熄灭
  digitalWrite(HCP_LED1, HIGH);
  digitalWrite(HCP_LED2, HIGH);
  digitalWrite(HCP_LED3, HIGH);
  digitalWrite(HCP_LED4, LOW);
}

void loop() {
  HCP.loop();   // 必须每轮调用：收发协议、扫描按键、上报证据
}
