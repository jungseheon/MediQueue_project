-- MediQueue 개발용 샘플 데이터 (데이터 전용 dump, 스키마 없음)
-- 스키마는 prisma/migrations가 만든다. 빈 DB에 `npm run db:migrate`를 실행한 뒤 1회만 복원한다.
--
-- 복원:
--   docker exec -i mediqueue-db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB' < dump.sql
-- 다시 생성:
--   docker exec mediqueue-db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --data-only --exclude-table=_prisma_migrations' > dump.sql
--   (생성 후 이 머리말 주석을 다시 붙인다)

--
-- PostgreSQL database dump
--

\restrict 1klyqSjWEWDrDHsbYYBC27PL6GFg7wpxU4DVZqtyxElAUIHa1tNfQo5IAehGwuv

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: doctors; Type: TABLE DATA; Schema: public; Owner: mediqueue
--

COPY public.doctors (id, display_name, department) FROM stdin;
1	가상 의사 1	가정의학과
2	가상 의사 2	내과
3	가상 의사 03	내과
4	가상 의사 04	소아과
5	가상 의사 05	정형외과
6	가상 의사 01	내과
7	가상 의사 02	가정의학과
8	가상 의사 03	정형외과
9	가상 의사 04	소아청소년과
10	가상 의사 05	피부과
11	가상 의사 06	이비인후과
12	가상 의사 07	안과
13	가상 의사 08	정신건강의학과
14	가상 의사 09	산부인과
15	가상 의사 10	신경과
16	가상 의사 11	내과
17	가상 의사 12	가정의학과
18	가상 의사 13	정형외과
19	가상 의사 14	소아청소년과
20	가상 의사 15	피부과
21	가상 의사 16	이비인후과
22	가상 의사 17	안과
23	가상 의사 18	정신건강의학과
24	가상 의사 19	산부인과
25	가상 의사 20	신경과
26	가상 의사 21	내과
27	가상 의사 22	가정의학과
28	가상 의사 23	정형외과
29	가상 의사 24	소아청소년과
30	가상 의사 25	피부과
\.


--
-- Data for Name: patients; Type: TABLE DATA; Schema: public; Owner: mediqueue
--

COPY public.patients (id, display_name) FROM stdin;
5	가상 환자 05
6	가상 환자 06
7	가상 환자 07
8	가상 환자 08
9	가상 환자 09
10	가상 환자 10
1	임지수1
2	정세헌
3	김태연
4	양윤서
11	가상 환자 01 김민준
12	가상 환자 02 이지민
13	가상 환자 03 박나윤
14	가상 환자 04 최서연
15	가상 환자 05 정수아
16	가상 환자 06 강시우
17	가상 환자 07 조도윤
18	가상 환자 08 윤주원
19	가상 환자 09 장다은
20	가상 환자 10 임지우
21	가상 환자 11 한하은
22	가상 환자 12 오건우
23	가상 환자 13 서하준
24	가상 환자 14 신유준
25	가상 환자 15 권유나
26	가상 환자 16 황서윤
27	가상 환자 17 안채원
28	가상 환자 18 송준서
29	가상 환자 19 전예준
30	가상 환자 20 홍현우
31	가상 환자 21 김민준
32	가상 환자 22 이지민
33	가상 환자 23 박나윤
34	가상 환자 24 최서연
35	가상 환자 25 정수아
\.


--
-- Data for Name: appointments; Type: TABLE DATA; Schema: public; Owner: mediqueue
--

COPY public.appointments (id, doctor_id, patient_id, scheduled_at, status) FROM stdin;
2	1	1	2026-10-27 04:14:49.235+00	booked
3	2	2	2026-10-27 04:29:49.24+00	booked
4	3	3	2026-10-27 04:44:49.241+00	booked
5	4	4	2026-10-27 04:59:49.241+00	booked
6	6	11	2026-10-26 00:00:00+00	booked
7	7	12	2026-10-24 23:15:00+00	booked
8	8	13	2026-10-23 22:30:00+00	booked
9	9	14	2026-10-23 00:00:00+00	booked
10	10	15	2026-10-21 23:15:00+00	booked
11	11	16	2026-10-20 22:30:00+00	booked
12	12	17	2026-10-20 00:00:00+00	booked
13	13	18	2026-10-18 23:15:00+00	booked
14	14	19	2026-10-26 23:25:00+00	booked
15	15	20	2026-10-26 22:40:00+00	booked
16	16	21	2026-10-23 22:00:00+00	booked
17	17	22	2026-10-22 22:00:00+00	booked
18	18	23	2026-10-25 00:00:00+00	cancelled
19	19	24	2026-10-27 00:30:00+00	booked
20	20	25	2026-10-27 00:55:00+00	booked
21	21	26	2026-10-27 01:20:00+00	booked
22	22	27	2026-10-27 01:45:00+00	booked
23	23	28	2026-10-27 02:10:00+00	booked
24	24	29	2026-10-28 02:00:00+00	booked
25	25	30	2026-10-29 03:00:00+00	booked
26	26	31	2026-10-30 04:00:00+00	booked
27	27	32	2026-10-31 05:00:00+00	booked
28	28	33	2026-11-01 06:00:00+00	booked
29	29	34	2026-11-02 07:00:00+00	booked
30	30	35	2026-11-03 00:00:00+00	booked
1	2	1	2026-10-27 04:23:47.795283+00	booked
31	30	35	2026-11-04 00:00:00+00	booked
32	1	1	2026-11-06 09:00:00+00	booked
\.


--
-- Data for Name: queue_entries; Type: TABLE DATA; Schema: public; Owner: mediqueue
--

COPY public.queue_entries (id, appointment_id, queue_position, status, checked_in_at, called_at, started_at, completed_at) FROM stdin;
6	6	0	completed	2026-10-25 23:48:00+00	\N	2026-10-26 00:05:00+00	2026-10-26 00:35:00+00
7	7	0	completed	2026-10-24 23:03:00+00	\N	2026-10-24 23:20:00+00	2026-10-24 23:50:00+00
8	8	0	completed	2026-10-23 22:18:00+00	\N	2026-10-23 22:35:00+00	2026-10-23 23:05:00+00
9	9	0	completed	2026-10-22 23:48:00+00	\N	2026-10-23 00:05:00+00	2026-10-23 00:35:00+00
10	10	0	completed	2026-10-21 23:03:00+00	\N	2026-10-21 23:20:00+00	2026-10-21 23:50:00+00
11	11	0	completed	2026-10-20 22:18:00+00	\N	2026-10-20 22:35:00+00	2026-10-20 23:05:00+00
12	12	0	completed	2026-10-19 23:48:00+00	\N	2026-10-20 00:05:00+00	2026-10-20 00:35:00+00
13	13	0	completed	2026-10-18 23:03:00+00	\N	2026-10-18 23:20:00+00	2026-10-18 23:50:00+00
14	14	2	in_progress	2026-10-26 23:05:00+00	\N	2026-10-26 23:17:00+00	\N
15	15	2	checked_in	2026-10-26 22:25:00+00	\N	\N	\N
16	16	0	no_show	\N	\N	\N	\N
17	17	0	no_show	\N	\N	\N	\N
18	18	0	cancelled	\N	\N	\N	\N
19	19	1	checked_in	2026-10-27 00:20:00+00	\N	\N	\N
20	20	1	checked_in	2026-10-27 00:45:00+00	\N	\N	\N
21	21	1	checked_in	2026-10-27 01:10:00+00	\N	\N	\N
22	22	1	checked_in	2026-10-27 01:35:00+00	\N	\N	\N
23	23	1	checked_in	2026-10-27 02:00:00+00	\N	\N	\N
1	1	1	checked_in	2026-11-06 13:19:40.43+00	\N	\N	\N
2	2	0	no_show	\N	\N	\N	\N
3	3	0	no_show	\N	\N	\N	\N
4	4	0	no_show	\N	\N	\N	\N
5	5	0	no_show	\N	\N	\N	\N
24	24	0	no_show	\N	\N	\N	\N
25	25	0	no_show	\N	\N	\N	\N
26	26	0	no_show	\N	\N	\N	\N
27	27	0	no_show	\N	\N	\N	\N
28	28	0	no_show	\N	\N	\N	\N
29	29	0	no_show	\N	\N	\N	\N
30	30	0	no_show	\N	\N	\N	\N
42	31	0	no_show	\N	\N	\N	\N
43	32	0	no_show	\N	\N	\N	\N
\.


--
-- Data for Name: service_time_stats; Type: TABLE DATA; Schema: public; Owner: mediqueue
--

COPY public.service_time_stats (doctor_id, service_type, ewma_minutes, sample_count, updated_at) FROM stdin;
6	초진	14.00	12	2026-10-27 06:43:43.684051+00
7	재진	27.25	29	2026-10-27 06:43:43.684051+00
8	초진	40.50	46	2026-10-27 06:43:43.684051+00
9	재진	24.75	63	2026-10-27 06:43:43.684051+00
10	초진	37.00	80	2026-10-27 06:43:43.684051+00
11	재진	21.25	97	2026-10-27 06:43:43.684051+00
12	초진	34.50	114	2026-10-27 06:43:43.684051+00
13	재진	18.75	131	2026-10-27 06:43:43.684051+00
14	초진	31.00	148	2026-10-27 06:43:43.684051+00
15	재진	15.25	165	2026-10-27 06:43:43.684051+00
16	초진	28.50	182	2026-10-27 06:43:43.684051+00
17	재진	41.75	19	2026-10-27 06:43:43.684051+00
18	초진	25.00	36	2026-10-27 06:43:43.684051+00
19	재진	38.25	53	2026-10-27 06:43:43.684051+00
20	초진	22.50	70	2026-10-27 06:43:43.684051+00
21	재진	35.75	87	2026-10-27 06:43:43.684051+00
22	초진	19.00	104	2026-10-27 06:43:43.684051+00
23	재진	32.25	121	2026-10-27 06:43:43.684051+00
24	초진	16.50	138	2026-10-27 06:43:43.684051+00
25	재진	29.75	155	2026-10-27 06:43:43.684051+00
26	초진	42.00	172	2026-10-27 06:43:43.684051+00
27	재진	26.25	189	2026-10-27 06:43:43.684051+00
28	초진	39.50	26	2026-10-27 06:43:43.684051+00
29	재진	23.75	43	2026-10-27 06:43:43.684051+00
30	초진	36.00	60	2026-10-27 06:43:43.684051+00
\.


--
-- Name: appointments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mediqueue
--

SELECT pg_catalog.setval('public.appointments_id_seq', 32, true);


--
-- Name: doctors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mediqueue
--

SELECT pg_catalog.setval('public.doctors_id_seq', 30, true);


--
-- Name: patients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mediqueue
--

SELECT pg_catalog.setval('public.patients_id_seq', 35, true);


--
-- Name: queue_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mediqueue
--

SELECT pg_catalog.setval('public.queue_entries_id_seq', 43, true);


--
-- PostgreSQL database dump complete
--

\unrestrict 1klyqSjWEWDrDHsbYYBC27PL6GFg7wpxU4DVZqtyxElAUIHa1tNfQo5IAehGwuv

