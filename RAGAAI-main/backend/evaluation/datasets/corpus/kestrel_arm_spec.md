# Kestrel K2 Collaborative Robotic Arm — Product Specification

Document number: SPEC-KES-002, revision C.

## Overview

The Kestrel K2 is a six-axis collaborative robotic arm designed for light assembly, inspection and laboratory automation. It is certified for human-robot collaboration under ISO 10218-1.

## Mechanical specifications

| Parameter | Value |
| --- | --- |
| Payload | 7.5 kg |
| Reach | 920 mm |
| Repeatability | ±0.03 mm |
| Weight | 24 kg |
| Ingress protection | IP54 |

## Power and controller

The arm runs on a 48 V DC supply and draws an average of 210 watts during typical pick-and-place cycles. The KC-3 controller supports EtherCAT and Modbus TCP and ships with the Halcyon Motion SDK for Python and C++.

## Safety

Collision detection stops the arm within 12 milliseconds of an unexpected contact. A hardware emergency-stop button is included on the teach pendant. The arm limits tool speed to 250 mm/s when a person is detected inside the collaborative zone.

## Warranty and service

The Kestrel K2 includes a 24-month warranty covering parts and labour. Preventive maintenance is recommended every 4,000 operating hours, mainly for gearbox lubrication on joints 2 and 3.
