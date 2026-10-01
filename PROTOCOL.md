# Attack Shark X68 HE protocol notes (decoded from qmk.top/v4 GearHub driver)

Device: VID 0x3151 (12625), PID 0x502D (20525), RY5088 chip, 8K. Interface usagePage 0xFFFF usage 2 (vendor), interface 2.
Driver names: ry5088_x68rt004_8k_dm (id 2270) and ry5088_x682_8k_dm (id 2472). Same key matrix. 4 profiles.

## Framing
- HID feature report, report id 0, 64 bytes. Send = sendFeatureReport(0, buf64). Read = receiveFeatureReport(0) after ~10ms.
- Checksum "Bit7": buf[7] = 255 - (sum(buf[0..6]) & 255). "Bit8": buf[8] = 255 - (sum(buf[0..7]) & 255) (used by LED param).
- Payload commands: 8-byte header + 56 data bytes.

## Commands
- 0x8F (143) GET id: reply[0]=143, uint32 LE device id at [1]. reply[7..8] = usb version (LE). reply[11]==1 light sync.
- 0x80 (128) GET RF version [1..2].
- 0xE6 (230) feature list: reply[1]==170 → supported; [2] precision enum 0=0.01mm(x100) 1=0.005mm(x200) 2=0.001mm(x1000); [3] gamepad.
  Legacy multiplier if unsupported: ver>=768&&<1280 → 100; ver>=1280 → 200; else 10.
- 1 RESET (factory reset) — 64 zero bytes with [0]=1.
- 3 SET report rate: [2]=0:8000 1:4000 2:2000 3:1000 4:500 5:250 6:125. GET 131 → [2].
- 4 SET profile [1]=0..3. GET 132 → [1].
- 6 SET debounce [1]. GET 134 → [1].
- 7 SET LED (checksum Bit8): [1]=effect idx, [2]=4-speed, [3]=bright, [4]=option<<4 | (dazzle?8:7), [5..7]=rgb (white 0xFFFFFF sent as 0xFAFFFA? -> 16449530). GET 135.
  Effects: 0 Off,1 AlwaysOn,2 Breath,3 Neon,4 Wave,5 Ripple,6 Raindrop,7 Snake,8 PressAction,9 Converage,10 SineWave,11 Kaleidoscope,12 LineWave,13 UserPicture,14 Laser,15 CircleWave,16 Dazzing,17 RainDown,18 Meteor,19 PressActionOff,20 MusicFollow3,21 ScreenColor,22 MusicFollow2,23 Train,24 FireWorks,25 UserColor
- 9 SET KB option: [1] sys 0 win 1 mac 2 ios 3 android, [2] fnIndex, [3] anti-mistouch, [4] RTStab/25 (0..4 → 0..100%), [5] WASD swap. GET 137.
- 10 SET keymatrix. Single: [1]=profile [2]=pos [5]=1 [6]=sublayer [8..11]=action. Bulk: [1]=profile [2]=255 [3]=chunk [4]=len [5]=last [6]=sublayer, 56B chunks of full 128*4 matrix.
  GET 138: [1]=profile [2]=255 [3]=chunk 0..7 [4]=sublayer → 8×64 bytes.
- 11 SET macro [1]=idx [2]=chunk [3]=56 [4]=last. GET 139 [1]=idx [2]=chunk 0..3.
  Macro buf: u16 repeat, then events: key: [hid, d<=127 ? (down?d|128:d) : (down?128:0), (lo,hi if long)]. mouse btn uses 240..244. move: [249, d or 0, dx, dy, (lo,hi)].
- 12 SET user pic (per-key RGB) [1]=profile? [2]=255 [3]=chunk 0..6 [4]=56 (last 42) [5]=last. 3 bytes/key by matrix pos (128 keys → 384 B). GET 140 chunks 0..5.
- 16 SET Fn layer: single [1]=sys [2]=profile [3]=pos [8..11]; bulk [3]=255 [4]=chunk 0..9 [5]=56 (0 last) [6]=last. GET 144 [1]=sys [2]=profile [3]=255 [4]=chunk.
- 17 SET sleep times. 23 auto OS (AutoOsen).
- 27 magnet report on/off (live travel stream). 28 min calibration on/off, 30 max calibration on/off.
- 101 SET multi magnetism: [1]=op [2]=1 bulk ([3]=chunk [4]=last) / [2]=0 single ([3]=pos [4]=last, data after 8B header).
  ops: 0 press travel(u16) 1 release travel(u16) 2 RT press(u16) 3 RT release(u16) 4 DKS actuation(u16) 5 MT time (/10, u8)
       6 bottom deadzone(u16) 7 key mode(u8) 8 DKS trigger modes(4B single only) 9 snap partner pos(u8) 10 all DKS trigger table
       251 top deadzone(u8) 252 switch type(u8) 254 live press travel (read) 255 live dynamic.
  Mode byte: low 7 bits 0 normal 2 dks 3 mt 4 tgl_hold 5 tgl_dots(rapid) 7 snap; bit7 = Rapid Trigger on.
  Travel value = mm × multiplier. Bulk u16 arrays are 128 entries (256 B, 5 chunks); defaults for unset: op0 200, op1 280, op6 30.
  GET 229: [1]=op [2]=1 [3]=chunk → 64B each. u16 ops read 4 chunks; u8 ops 2 chunks; op10 8 chunks (4×128).
- DKS: triggerModes[4] (one byte per bound action), each byte = 4×2-bit stage codes (stage0 bits0-1 ... stage3 bits6-7).
  Bound actions live in key matrix sublayers 0..3 of the profile. MT: sublayer0 = hold action, sublayer1 = tap action. TGL: sublayer0.
- Switch types (op252): 0 高特(Gateron),1 磁玉,2 磁玉pro,3 磁玉gaming,4 天王,5 万磁王,6 科泰,7 机械轴,8 磁白轴,9 磁玉定制,10 万磁王pro,11 天王SE,12 万磁王RGB,13 万磁王POM,14 磁神轴,15 凯华轴,16 TTC万磁王...
- Top deadzone supported if usb/rf version >= 1024.

## Action encoding (4 bytes)
- [0, mods, hid, hid2] keyboard/combo; [0,0,0,0] disabled; [1,0,240..248,x] mouse; [3,0,lo,hi] consumer (vol up 233, down 234, mute 226, play 205, next 181, prev 182, calc 146 1, mycomputer 148 1);
  [9, mode, idx, 0] macro (mode 0 repeat, 1 on/off toggle, 2 hold-repeat); [10,1,0,0] Fn; [10,13] fn lock; [13,x,y] lighting controls; [8,0,n] profile switch; [24,k1,k2,t/10] MT.
- Modifier bits in mods: 0x01 LCtrl 0x02 LShift 0x04 LAlt 0x08 LGui ... (standard HID mod byte) — verify.

## Matrix (pos = col*6 + row), 128 slots, 71 used (pos 10 ISO key and 90-92 volume are not physical on ANSI X68).
