--
-- PostgreSQL database dump
--

\restrict NbJaQ2bwdNpOInpLcbgcIKViaXt3kLphq8BeA3gLsHFYSuiSvtyK6u7D0ZXZTxu

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg13+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.user_skills DROP CONSTRAINT IF EXISTS user_skills_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.user_skills DROP CONSTRAINT IF EXISTS user_skills_skill_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tasks_v2 DROP CONSTRAINT IF EXISTS tasks_v2_task_group_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tasks_v2 DROP CONSTRAINT IF EXISTS tasks_v2_support_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tasks_v2 DROP CONSTRAINT IF EXISTS tasks_v2_skill_vendor_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tasks_v2 DROP CONSTRAINT IF EXISTS tasks_v2_skill_solution_id_fkey;
ALTER TABLE IF EXISTS ONLY public.tasks_v2 DROP CONSTRAINT IF EXISTS tasks_v2_assigned_id_fkey;
ALTER TABLE IF EXISTS ONLY public.task_groups DROP CONSTRAINT IF EXISTS task_groups_phase_id_fkey;
ALTER TABLE IF EXISTS ONLY public.skills DROP CONSTRAINT IF EXISTS skills_group_id_fkey;
ALTER TABLE IF EXISTS ONLY public.projects DROP CONSTRAINT IF EXISTS projects_technical_leader_id_fkey;
ALTER TABLE IF EXISTS ONLY public.projects DROP CONSTRAINT IF EXISTS projects_pm_id_fkey;
ALTER TABLE IF EXISTS ONLY public.project_members_v2 DROP CONSTRAINT IF EXISTS project_members_v2_project_id_fkey;
ALTER TABLE IF EXISTS ONLY public.project_members_v2 DROP CONSTRAINT IF EXISTS project_members_v2_member_id_fkey;
ALTER TABLE IF EXISTS ONLY public.project_links DROP CONSTRAINT IF EXISTS project_links_project_id_fkey;
ALTER TABLE IF EXISTS ONLY public.project_links DROP CONSTRAINT IF EXISTS project_links_platform_id_fkey;
ALTER TABLE IF EXISTS ONLY public.phases DROP CONSTRAINT IF EXISTS phases_project_id_fkey;
ALTER TABLE IF EXISTS ONLY public.member_skills DROP CONSTRAINT IF EXISTS member_skills_skill_id_fkey;
ALTER TABLE IF EXISTS ONLY public.member_skills DROP CONSTRAINT IF EXISTS member_skills_member_id_fkey;
ALTER TABLE IF EXISTS ONLY public.meetings DROP CONSTRAINT IF EXISTS meetings_project_id_fkey;
ALTER TABLE IF EXISTS ONLY public.meetings DROP CONSTRAINT IF EXISTS meetings_created_by_fkey;
ALTER TABLE IF EXISTS ONLY public.meeting_members DROP CONSTRAINT IF EXISTS meeting_members_member_id_fkey;
ALTER TABLE IF EXISTS ONLY public.meeting_members DROP CONSTRAINT IF EXISTS meeting_members_meeting_id_fkey;
ALTER TABLE IF EXISTS ONLY public.groups DROP CONSTRAINT IF EXISTS groups_category_id_fkey;
DROP INDEX IF EXISTS public.ix_teams_id;
DROP INDEX IF EXISTS public.ix_tasks_v2_task_group_id;
DROP INDEX IF EXISTS public.ix_tasks_v2_id;
DROP INDEX IF EXISTS public.ix_task_statuses_id;
DROP INDEX IF EXISTS public.ix_task_priorities_id;
DROP INDEX IF EXISTS public.ix_task_groups_phase_id;
DROP INDEX IF EXISTS public.ix_task_groups_id;
DROP INDEX IF EXISTS public.ix_skills_id;
DROP INDEX IF EXISTS public.ix_projects_id;
DROP INDEX IF EXISTS public.ix_projects_code;
DROP INDEX IF EXISTS public.ix_project_links_id;
DROP INDEX IF EXISTS public.ix_positions_id;
DROP INDEX IF EXISTS public.ix_platforms_id;
DROP INDEX IF EXISTS public.ix_phases_project_id;
DROP INDEX IF EXISTS public.ix_phases_id;
DROP INDEX IF EXISTS public.ix_members_id;
DROP INDEX IF EXISTS public.ix_members_display_name;
DROP INDEX IF EXISTS public.ix_meetings_id;
DROP INDEX IF EXISTS public.ix_meeting_members_id;
DROP INDEX IF EXISTS public.ix_groups_id;
DROP INDEX IF EXISTS public.ix_departments_id;
DROP INDEX IF EXISTS public.ix_customers_id;
DROP INDEX IF EXISTS public.ix_categories_id;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE IF EXISTS ONLY public.user_skills DROP CONSTRAINT IF EXISTS user_skills_pkey;
ALTER TABLE IF EXISTS ONLY public.teams DROP CONSTRAINT IF EXISTS teams_pkey;
ALTER TABLE IF EXISTS ONLY public.teams DROP CONSTRAINT IF EXISTS teams_name_key;
ALTER TABLE IF EXISTS ONLY public.tasks_v2 DROP CONSTRAINT IF EXISTS tasks_v2_pkey;
ALTER TABLE IF EXISTS ONLY public.task_statuses DROP CONSTRAINT IF EXISTS task_statuses_pkey;
ALTER TABLE IF EXISTS ONLY public.task_statuses DROP CONSTRAINT IF EXISTS task_statuses_name_key;
ALTER TABLE IF EXISTS ONLY public.task_priorities DROP CONSTRAINT IF EXISTS task_priorities_pkey;
ALTER TABLE IF EXISTS ONLY public.task_priorities DROP CONSTRAINT IF EXISTS task_priorities_name_key;
ALTER TABLE IF EXISTS ONLY public.task_groups DROP CONSTRAINT IF EXISTS task_groups_pkey;
ALTER TABLE IF EXISTS ONLY public.skills DROP CONSTRAINT IF EXISTS skills_pkey;
ALTER TABLE IF EXISTS ONLY public.settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE IF EXISTS ONLY public.settings DROP CONSTRAINT IF EXISTS settings_key_key;
ALTER TABLE IF EXISTS ONLY public.projects DROP CONSTRAINT IF EXISTS projects_pkey;
ALTER TABLE IF EXISTS ONLY public.project_members_v2 DROP CONSTRAINT IF EXISTS project_members_v2_pkey;
ALTER TABLE IF EXISTS ONLY public.project_links DROP CONSTRAINT IF EXISTS project_links_pkey;
ALTER TABLE IF EXISTS ONLY public.positions DROP CONSTRAINT IF EXISTS positions_pkey;
ALTER TABLE IF EXISTS ONLY public.positions DROP CONSTRAINT IF EXISTS positions_name_key;
ALTER TABLE IF EXISTS ONLY public.platforms DROP CONSTRAINT IF EXISTS platforms_pkey;
ALTER TABLE IF EXISTS ONLY public.platforms DROP CONSTRAINT IF EXISTS platforms_name_key;
ALTER TABLE IF EXISTS ONLY public.phases DROP CONSTRAINT IF EXISTS phases_pkey;
ALTER TABLE IF EXISTS ONLY public.members DROP CONSTRAINT IF EXISTS members_pkey;
ALTER TABLE IF EXISTS ONLY public.member_skills DROP CONSTRAINT IF EXISTS member_skills_pkey;
ALTER TABLE IF EXISTS ONLY public.meetings DROP CONSTRAINT IF EXISTS meetings_pkey;
ALTER TABLE IF EXISTS ONLY public.meeting_members DROP CONSTRAINT IF EXISTS meeting_members_pkey;
ALTER TABLE IF EXISTS ONLY public.groups DROP CONSTRAINT IF EXISTS groups_pkey;
ALTER TABLE IF EXISTS ONLY public.departments DROP CONSTRAINT IF EXISTS departments_pkey;
ALTER TABLE IF EXISTS ONLY public.departments DROP CONSTRAINT IF EXISTS departments_name_key;
ALTER TABLE IF EXISTS ONLY public.customers DROP CONSTRAINT IF EXISTS customers_pkey;
ALTER TABLE IF EXISTS ONLY public.customers DROP CONSTRAINT IF EXISTS customers_name_key;
ALTER TABLE IF EXISTS ONLY public.categories DROP CONSTRAINT IF EXISTS categories_pkey;
ALTER TABLE IF EXISTS ONLY public.categories DROP CONSTRAINT IF EXISTS categories_name_key;
ALTER TABLE IF EXISTS ONLY public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_pkey;
ALTER TABLE IF EXISTS public.users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.teams ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.tasks_v2 ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.task_statuses ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.task_priorities ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.task_groups ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.skills ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.settings ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.projects ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.project_members_v2 ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.project_links ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.positions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.platforms ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.phases ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.members ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.meetings ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.meeting_members ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.groups ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.departments ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.customers ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.categories ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.audit_logs ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.users_id_seq;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.user_skills;
DROP SEQUENCE IF EXISTS public.teams_id_seq;
DROP TABLE IF EXISTS public.teams;
DROP SEQUENCE IF EXISTS public.tasks_v2_id_seq;
DROP TABLE IF EXISTS public.tasks_v2;
DROP SEQUENCE IF EXISTS public.task_statuses_id_seq;
DROP TABLE IF EXISTS public.task_statuses;
DROP SEQUENCE IF EXISTS public.task_priorities_id_seq;
DROP TABLE IF EXISTS public.task_priorities;
DROP SEQUENCE IF EXISTS public.task_groups_id_seq;
DROP TABLE IF EXISTS public.task_groups;
DROP SEQUENCE IF EXISTS public.skills_id_seq;
DROP TABLE IF EXISTS public.skills;
DROP SEQUENCE IF EXISTS public.settings_id_seq;
DROP TABLE IF EXISTS public.settings;
DROP SEQUENCE IF EXISTS public.projects_id_seq;
DROP TABLE IF EXISTS public.projects;
DROP SEQUENCE IF EXISTS public.project_members_v2_id_seq;
DROP TABLE IF EXISTS public.project_members_v2;
DROP SEQUENCE IF EXISTS public.project_links_id_seq;
DROP TABLE IF EXISTS public.project_links;
DROP SEQUENCE IF EXISTS public.positions_id_seq;
DROP TABLE IF EXISTS public.positions;
DROP SEQUENCE IF EXISTS public.platforms_id_seq;
DROP TABLE IF EXISTS public.platforms;
DROP SEQUENCE IF EXISTS public.phases_id_seq;
DROP TABLE IF EXISTS public.phases;
DROP SEQUENCE IF EXISTS public.members_id_seq;
DROP TABLE IF EXISTS public.members;
DROP TABLE IF EXISTS public.member_skills;
DROP SEQUENCE IF EXISTS public.meetings_id_seq;
DROP TABLE IF EXISTS public.meetings;
DROP SEQUENCE IF EXISTS public.meeting_members_id_seq;
DROP TABLE IF EXISTS public.meeting_members;
DROP SEQUENCE IF EXISTS public.groups_id_seq;
DROP TABLE IF EXISTS public.groups;
DROP SEQUENCE IF EXISTS public.departments_id_seq;
DROP TABLE IF EXISTS public.departments;
DROP SEQUENCE IF EXISTS public.customers_id_seq;
DROP TABLE IF EXISTS public.customers;
DROP SEQUENCE IF EXISTS public.categories_id_seq;
DROP TABLE IF EXISTS public.categories;
DROP SEQUENCE IF EXISTS public.audit_logs_id_seq;
DROP TABLE IF EXISTS public.audit_logs;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    user_email character varying,
    action character varying,
    detail text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id integer NOT NULL,
    name character varying NOT NULL,
    is_active boolean,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    name character varying NOT NULL,
    description character varying
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    name character varying NOT NULL,
    description character varying
);


--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id integer NOT NULL,
    name character varying NOT NULL,
    category_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.groups_id_seq OWNED BY public.groups.id;


--
-- Name: meeting_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_members (
    id integer NOT NULL,
    meeting_id integer NOT NULL,
    member_id integer NOT NULL,
    role character varying(30),
    joined_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: meeting_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meeting_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meeting_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meeting_members_id_seq OWNED BY public.meeting_members.id;


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id integer NOT NULL,
    title character varying(250) NOT NULL,
    description text,
    platform character varying(50),
    meeting_url text,
    meeting_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone,
    status character varying(30),
    transcript text,
    ai_summary json,
    project_id integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: meetings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meetings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meetings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meetings_id_seq OWNED BY public.meetings.id;


--
-- Name: member_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_skills (
    member_id integer NOT NULL,
    skill_id integer NOT NULL
);


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id integer NOT NULL,
    display_name character varying(50) NOT NULL,
    full_name character varying(255) NOT NULL,
    email character varying(255),
    telegram_username character varying(100),
    phone character varying(20),
    birth_date date,
    gender character varying(20),
    team character varying(100),
    "position" character varying(100),
    department character varying(100),
    experience_year integer,
    created_at character varying
);


--
-- Name: members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.members_id_seq OWNED BY public.members.id;


--
-- Name: phases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phases (
    id integer NOT NULL,
    project_id integer NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    sort_order integer,
    status character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: phases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.phases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: phases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.phases_id_seq OWNED BY public.phases.id;


--
-- Name: platforms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platforms (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    icon character varying(50),
    color character varying(20),
    is_active boolean
);


--
-- Name: platforms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platforms_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platforms_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platforms_id_seq OWNED BY public.platforms.id;


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id integer NOT NULL,
    name character varying NOT NULL,
    description character varying
);


--
-- Name: positions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.positions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: positions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.positions_id_seq OWNED BY public.positions.id;


--
-- Name: project_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_links (
    id integer NOT NULL,
    project_id integer NOT NULL,
    platform_id integer,
    name character varying(200) NOT NULL,
    url character varying(500) NOT NULL,
    description character varying(500),
    sort_order integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: project_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_links_id_seq OWNED BY public.project_links.id;


--
-- Name: project_members_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members_v2 (
    id integer NOT NULL,
    project_id integer NOT NULL,
    member_id integer NOT NULL,
    role character varying(50)
);


--
-- Name: project_members_v2_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_members_v2_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_members_v2_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_members_v2_id_seq OWNED BY public.project_members_v2.id;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    code character varying(50),
    customer_name character varying(200),
    year integer,
    pm_id integer,
    technical_leader_id integer,
    description text,
    status character varying(50),
    current_phase character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.projects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id integer NOT NULL,
    key character varying NOT NULL,
    value text NOT NULL,
    updated_by integer,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    id integer NOT NULL,
    name character varying NOT NULL,
    group_id integer NOT NULL,
    is_active boolean,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skills_id_seq OWNED BY public.skills.id;


--
-- Name: task_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_groups (
    id integer NOT NULL,
    phase_id integer NOT NULL,
    name character varying(500) NOT NULL,
    description text,
    status character varying(50),
    progress numeric(5,2),
    manday_est numeric(5,2),
    start_date_est date,
    end_date_est date,
    manday_actual numeric(5,2),
    end_date_actual date,
    sort_order integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: task_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_groups_id_seq OWNED BY public.task_groups.id;


--
-- Name: task_priorities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_priorities (
    id integer NOT NULL,
    name character varying NOT NULL,
    kpi_base integer NOT NULL,
    color character varying NOT NULL
);


--
-- Name: task_priorities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_priorities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_priorities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_priorities_id_seq OWNED BY public.task_priorities.id;


--
-- Name: task_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_statuses (
    id integer NOT NULL,
    name character varying NOT NULL
);


--
-- Name: task_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_statuses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_statuses_id_seq OWNED BY public.task_statuses.id;


--
-- Name: tasks_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks_v2 (
    id integer NOT NULL,
    task_group_id integer NOT NULL,
    task_code character varying(30),
    detail character varying(500) NOT NULL,
    priority character varying(50),
    manday_est numeric(5,2),
    status character varying(50),
    start_date date,
    assigned_id integer,
    support_id integer,
    kpi_ratio_assign integer,
    kpi_ratio_support integer,
    skill_solution_id integer,
    skill_vendor_id integer,
    ticket_id character varying(500),
    remark character varying(500),
    send character varying(500),
    sort_order integer,
    end_date_est date,
    manday_actual numeric(5,2),
    end_date_actual date,
    days_late integer,
    kpi_base numeric(10,2),
    kpi_perform numeric(10,2),
    kpi_ot numeric(10,2),
    kpi_final numeric(10,2),
    kpi_assigned numeric(10,2),
    kpi_support numeric(10,2),
    notes text,
    solution character varying(200),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: tasks_v2_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_v2_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_v2_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_v2_id_seq OWNED BY public.tasks_v2.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id integer NOT NULL,
    name character varying NOT NULL,
    description character varying
);


--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: user_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_skills (
    user_id integer NOT NULL,
    skill_id integer NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying NOT NULL,
    full_name character varying,
    hashed_pw character varying NOT NULL,
    role character varying,
    is_active boolean,
    "position" character varying,
    department character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups ALTER COLUMN id SET DEFAULT nextval('public.groups_id_seq'::regclass);


--
-- Name: meeting_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_members ALTER COLUMN id SET DEFAULT nextval('public.meeting_members_id_seq'::regclass);


--
-- Name: meetings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings ALTER COLUMN id SET DEFAULT nextval('public.meetings_id_seq'::regclass);


--
-- Name: members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members ALTER COLUMN id SET DEFAULT nextval('public.members_id_seq'::regclass);


--
-- Name: phases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases ALTER COLUMN id SET DEFAULT nextval('public.phases_id_seq'::regclass);


--
-- Name: platforms id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platforms ALTER COLUMN id SET DEFAULT nextval('public.platforms_id_seq'::regclass);


--
-- Name: positions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions ALTER COLUMN id SET DEFAULT nextval('public.positions_id_seq'::regclass);


--
-- Name: project_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_links ALTER COLUMN id SET DEFAULT nextval('public.project_links_id_seq'::regclass);


--
-- Name: project_members_v2 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members_v2 ALTER COLUMN id SET DEFAULT nextval('public.project_members_v2_id_seq'::regclass);


--
-- Name: projects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills ALTER COLUMN id SET DEFAULT nextval('public.skills_id_seq'::regclass);


--
-- Name: task_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_groups ALTER COLUMN id SET DEFAULT nextval('public.task_groups_id_seq'::regclass);


--
-- Name: task_priorities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_priorities ALTER COLUMN id SET DEFAULT nextval('public.task_priorities_id_seq'::regclass);


--
-- Name: task_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_statuses ALTER COLUMN id SET DEFAULT nextval('public.task_statuses_id_seq'::regclass);


--
-- Name: tasks_v2 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks_v2 ALTER COLUMN id SET DEFAULT nextval('public.tasks_v2_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, user_email, action, detail, created_at) FROM stdin;
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categories (id, name, is_active, created_at) FROM stdin;
1	I. NETWORK SOLUTIONS	t	2026-07-13 07:15:06.519193
2	II. SYSTEM & SERVER SOLUTIONS	t	2026-07-13 07:15:06.519193
3	III. SECURITY SOLUTIONS	t	2026-07-13 07:15:06.519193
4	IV. VOICE CONFERENCING & COLLABORATION	t	2026-07-13 07:15:06.519193
5	V. SOFTWARE	t	2026-07-13 07:15:06.519193
6	VI. PROJECT MANAGER	t	2026-07-13 07:15:06.519193
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customers (id, name, description) FROM stdin;
1	Samsung SDS	\N
2	LG CNS	\N
3	Viettel	\N
4	FPT Software	\N
5	Vingroup	\N
\.


--
-- Data for Name: departments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.departments (id, name, description) FROM stdin;
1	AI	\N
2	ERP	\N
3	QA	\N
4	Infrastructure	\N
5	Marketing	\N
\.


--
-- Data for Name: groups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.groups (id, name, category_id, created_at) FROM stdin;
1	Switching & Routing	1	2026-07-13 07:15:06.519193
2	Wireless	1	2026-07-13 07:15:06.519193
3	Load Balancing	1	2026-07-13 07:15:06.519193
4	VPN & MPLS	1	2026-07-13 07:15:06.519193
5	NAC	1	2026-07-13 07:15:06.519193
6	Monitoring	1	2026-07-13 07:15:06.519193
7	Operating Systems	2	2026-07-13 07:15:06.519193
8	Virtualization & Cloud	2	2026-07-13 07:15:06.519193
9	Server	2	2026-07-13 07:15:06.519193
10	Storage	2	2026-07-13 07:15:06.519193
11	Backup	2	2026-07-13 07:15:06.519193
12	Database	2	2026-07-13 07:15:06.519193
13	Firewall	3	2026-07-13 07:15:06.519193
14	WAF/DBF	3	2026-07-13 07:15:06.519193
15	SIEM & Log	3	2026-07-13 07:15:06.519193
16	Pentesting	3	2026-07-13 07:15:06.519193
17	Endpoint Security	3	2026-07-13 07:15:06.519193
18	Identity & MFA	3	2026-07-13 07:15:06.519193
19	Video Conferencing	4	2026-07-13 07:15:06.519193
20	Call Center	4	2026-07-13 07:15:06.519193
21	Automation	5	2026-07-13 07:15:06.519193
22	IaC	5	2026-07-13 07:15:06.519193
23	Containerization	5	2026-07-13 07:15:06.519193
24	Sales	6	2026-07-13 07:15:06.519193
25	Presales	6	2026-07-13 07:15:06.519193
26	Project Manager	6	2026-07-13 07:15:06.519193
\.


--
-- Data for Name: meeting_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.meeting_members (id, meeting_id, member_id, role, joined_at, created_at) FROM stdin;
\.


--
-- Data for Name: meetings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.meetings (id, title, description, platform, meeting_url, meeting_date, start_time, end_time, status, transcript, ai_summary, project_id, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: member_skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.member_skills (member_id, skill_id) FROM stdin;
\.


--
-- Data for Name: members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.members (id, display_name, full_name, email, telegram_username, phone, birth_date, gender, team, "position", department, experience_year, created_at) FROM stdin;
1	1.Minhpn	Minh	\N	@minhuit911	\N	\N	\N	Sales	\N	\N	0	2026-07-13T07:15:07.389342
2	6.Phil	Phil	\N	@phile0920	\N	\N	\N	Sales	\N	\N	0	2026-07-13T07:15:07.399638
3	8.Nhớlnha	Nhớ	\N	@AnhNho66	\N	\N	\N	Sales	\N	\N	0	2026-07-13T07:15:07.400453
4	9.Phátnt	Phát	\N	@phatnguyeen	\N	\N	\N	Sales	\N	\N	0	2026-07-13T07:15:07.401139
5	2.Phướcpv	Phước	\N	@nessivu	\N	\N	\N	Presales	\N	\N	0	2026-07-13T07:15:07.402019
6	3.Hând	Hân	\N	@handiep	\N	\N	\N	Presales	\N	\N	0	2026-07-13T07:15:07.402526
7	4.Yêmh	Yên	\N	@yemhoang96	\N	\N	\N	Presales	\N	\N	0	2026-07-13T07:15:07.403102
8	5.Khôipm	Khôi	\N	@BlackDrag0n98	\N	\N	\N	Presales	\N	\N	0	2026-07-13T07:15:07.403672
9	7.Vypt	Vy	\N	@vyvyzz13	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.404346
10	10.Huyht	Huy	\N	@ht_hyu	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.404912
11	11.Hânlnl	Hân	\N	@Linhhan0399	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.405413
12	12.Vũnl	Vũ	\N	@vu_nguyen27	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.405909
13	14.Túbda	Tú	\N	@numm0204	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.406317
14	15.Huấnnv	Huấn	\N	@huannv21	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.406764
15	17.Sơnpn	Sơn	\N	@Sonngocpham	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.407199
16	18.Thuậnlh	Thuận	\N	@thuanle0608	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.407701
17	25.Chínhvđ	Chính	\N	@duci59	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.408123
18	28.Phátntu	Phát	\N	@phatnguyentuan	\N	\N	\N	Technical	\N	\N	0	2026-07-13T07:15:07.408609
19	13.Tâylt	Tây	\N	@lethitay	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.409330
20	16.Dũngnh	Dũng	\N	@ru4ff	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.409876
21	26.Phúlt	Phú	\N	@letrieuphu	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.410488
22	27.Duynđ	Duy	\N	@duyisme_rynn	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.411300
23	29.Anhpxt	Anh	\N	@tunanhdapoet	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.412011
24	30.Tàipv	Tài	\N	@taipvan	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.412780
25	31.Hiệplh	Hiệp	\N	@hhieple03	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.413473
26	32.Thànhndn	Thành	\N	@thanh25324	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.414204
27	33.Phươngvt	Phương	\N	@tpunn00	\N	\N	\N	Intern L2	\N	\N	0	2026-07-13T07:15:07.415094
28	Sếp Thương	Thương	\N	\N	\N	\N	\N	Developer	\N	\N	0	2026-07-13T07:15:07.415881
29	Sếp Nhi	Nhi	\N	\N	\N	\N	\N	Developer	\N	\N	0	2026-07-13T07:15:07.416555
30	Chị Trang	Trang	\N	@Trang07	\N	\N	\N	Developer	\N	\N	0	2026-07-13T07:15:07.417140
\.


--
-- Data for Name: phases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.phases (id, project_id, name, description, sort_order, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: platforms; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.platforms (id, name, icon, color, is_active) FROM stdin;
1	Telegram	📨	#0088cc	t
2	Zalo	💬	#0068ff	t
3	Slack	💼	#4A154B	t
4	Microsoft Teams	🟦	#6264A7	t
5	Discord	🎮	#5865F2	t
6	WhatsApp	📱	#25D366	t
7	Khác	🔗	#6b7280	t
\.


--
-- Data for Name: positions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.positions (id, name, description) FROM stdin;
1	PM	\N
2	Leader	\N
3	Developer	\N
4	Tester	\N
5	Intern	\N
\.


--
-- Data for Name: project_links; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_links (id, project_id, platform_id, name, url, description, sort_order, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: project_members_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_members_v2 (id, project_id, member_id, role) FROM stdin;
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.projects (id, name, code, customer_name, year, pm_id, technical_leader_id, description, status, current_phase, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings (id, key, value, updated_by, updated_at) FROM stdin;
1	column_config	{"cols": ["DETAIL TASK", "PRIORITY", "MANDAY (EST)", "STATUS", "ASSIGNED"], "tab_names": []}	\N	2026-07-13 07:15:06.519193
2	policy	{"rules": [{"field": "PRIORITY", "value": "URGENT", "manday_max": 2.0, "min_words": 10, "required_fields": ["ASSIGNED", "STATUS"]}, {"field": "PRIORITY", "value": "CRITICAL", "manday_max": 3.0, "min_words": 15, "required_fields": ["ASSIGNED", "STATUS"]}, {"field": "PRIORITY", "value": "HIGH", "manday_max": 5.0, "min_words": 5, "required_fields": ["ASSIGNED"]}]}	\N	2026-07-13 07:15:06.519193
3	ai_config	{"base_url": "https://api.shopaikey.com/v1", "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "model": "gpt-4o-mini", "system_prompt": "Bạn là trợ lý ảo kiểm soát chất lượng & tuân thủ quy trình dự án.\\nHãy đánh giá dòng công việc (task) sau từ Google Sheet:\\n1. Kiểm tra xem mô tả công việc (DETAIL TASK) có đủ rõ ràng, có đầy đủ mục tiêu, kết quả bàn giao hay không.\\n2. Đánh giá xem Manday (MANDAY (EST)) có quá cao hay quá thấp so với mô tả công việc không.\\n3. Trả về phán quyết (PASS, FAIL, hoặc REVIEW).\\n4. Đưa ra Lý do (tiếng Việt).\\n5. Đưa ra Gợi ý cải thiện cụ thể (tiếng Việt).\\nĐịnh dạng trả về bắt buộc là JSON hợp lệ có dạng: {\\"verdict\\":\\"...\\",\\"reason\\":\\"...\\",\\"suggestion\\":\\"...\\"}\\nKhông viết markdown, không thêm ký tự ngoài JSON.", "check_interval_hours": 1}	\N	2026-07-13 07:15:06.519193
\.


--
-- Data for Name: skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.skills (id, name, group_id, is_active, created_at) FROM stdin;
1	Allied	1	t	2026-07-13 07:15:06.519193
2	Allied	2	t	2026-07-13 07:15:06.519193
3	F5	3	t	2026-07-13 07:15:06.519193
4	Cisco	4	t	2026-07-13 07:15:06.519193
5	Forescount	5	t	2026-07-13 07:15:06.519193
6	Solarwind	6	t	2026-07-13 07:15:06.519193
7	Redhat	7	t	2026-07-13 07:15:06.519193
8	VMware	8	t	2026-07-13 07:15:06.519193
9	HPE	9	t	2026-07-13 07:15:06.519193
10	HPE	10	t	2026-07-13 07:15:06.519193
11	Commvault	11	t	2026-07-13 07:15:06.519193
12	MS SQL	12	t	2026-07-13 07:15:06.519193
13	Palo Alto	13	t	2026-07-13 07:15:06.519193
14	IBM Guardium	14	t	2026-07-13 07:15:06.519193
15	Splunk	15	t	2026-07-13 07:15:06.519193
16	Pentest Website	16	t	2026-07-13 07:15:06.519193
17	Palo Alto	17	t	2026-07-13 07:15:06.519193
18	Beyound Trust	18	t	2026-07-13 07:15:06.519193
19	Zoom	19	t	2026-07-13 07:15:06.519193
20	Avaya	20	t	2026-07-13 07:15:06.519193
21	CI/CD	21	t	2026-07-13 07:15:06.519193
22	Terraform	22	t	2026-07-13 07:15:06.519193
23	Docker	23	t	2026-07-13 07:15:06.519193
24	Consultation & Sales	24	t	2026-07-13 07:15:06.519193
25	Network	25	t	2026-07-13 07:15:06.519193
26	Project Planning	26	t	2026-07-13 07:15:06.519193
27	Juniper	1	t	2026-07-13 07:15:06.519193
28	Cisco	2	t	2026-07-13 07:15:06.519193
29	Nginx	3	t	2026-07-13 07:15:06.519193
30	Fortinet	4	t	2026-07-13 07:15:06.519193
31	Clearpass	5	t	2026-07-13 07:15:06.519193
32	Zabbix	6	t	2026-07-13 07:15:06.519193
33	CentOS	7	t	2026-07-13 07:15:06.519193
34	Promox	8	t	2026-07-13 07:15:06.519193
35	Dell	9	t	2026-07-13 07:15:06.519193
36	Dell	10	t	2026-07-13 07:15:06.519193
37	Veeam	11	t	2026-07-13 07:15:06.519193
38	Oracle	12	t	2026-07-13 07:15:06.519193
39	Checkpoint	13	t	2026-07-13 07:15:06.519193
40	Imperva	14	t	2026-07-13 07:15:06.519193
41	OpenSearch	15	t	2026-07-13 07:15:06.519193
42	Pentest Network	16	t	2026-07-13 07:15:06.519193
43	Checkpoint	17	t	2026-07-13 07:15:06.519193
44	Cyber Ark	18	t	2026-07-13 07:15:06.519193
45	Pexip	19	t	2026-07-13 07:15:06.519193
46	Nice	20	t	2026-07-13 07:15:06.519193
47	GitOps	21	t	2026-07-13 07:15:06.519193
48	Ansible	22	t	2026-07-13 07:15:06.519193
49	Kubernetes	23	t	2026-07-13 07:15:06.519193
50	Internal Coordination	24	t	2026-07-13 07:15:06.519193
51	System	25	t	2026-07-13 07:15:06.519193
52	Performance Management	26	t	2026-07-13 07:15:06.519193
53	Cisco	1	t	2026-07-13 07:15:06.519193
54	Aruba	2	t	2026-07-13 07:15:06.519193
55	Radware	3	t	2026-07-13 07:15:06.519193
56	Palo Alto	4	t	2026-07-13 07:15:06.519193
57	Prometheus	6	t	2026-07-13 07:15:06.519193
58	Ubuntu	7	t	2026-07-13 07:15:06.519193
59	Hyper-V	8	t	2026-07-13 07:15:06.519193
60	Fujitsu	9	t	2026-07-13 07:15:06.519193
61	Fujitsu	10	t	2026-07-13 07:15:06.519193
62	Veritas	11	t	2026-07-13 07:15:06.519193
63	Postgresql	12	t	2026-07-13 07:15:06.519193
64	Fortinet	13	t	2026-07-13 07:15:06.519193
65	Datasunrise	14	t	2026-07-13 07:15:06.519193
66	Elastic	15	t	2026-07-13 07:15:06.519193
67	Pentest Server	16	t	2026-07-13 07:15:06.519193
68	Fortinet	17	t	2026-07-13 07:15:06.519193
69	ManageEngine	18	t	2026-07-13 07:15:06.519193
70	Poly	19	t	2026-07-13 07:15:06.519193
71	Cisco	20	t	2026-07-13 07:15:06.519193
72	AI	21	t	2026-07-13 07:15:06.519193
73	Report & Forecast	24	t	2026-07-13 07:15:06.519193
74	Security	25	t	2026-07-13 07:15:06.519193
75	Final Report/Review	26	t	2026-07-13 07:15:06.519193
76	Aruba	1	t	2026-07-13 07:15:06.519193
77	Ruckus	2	t	2026-07-13 07:15:06.519193
78	A10	3	t	2026-07-13 07:15:06.519193
79	Juniper	4	t	2026-07-13 07:15:06.519193
80	Grafana	6	t	2026-07-13 07:15:06.519193
81	Windows	7	t	2026-07-13 07:15:06.519193
82	AWS	8	t	2026-07-13 07:15:06.519193
83	H3C	9	t	2026-07-13 07:15:06.519193
84	Netapp	10	t	2026-07-13 07:15:06.519193
85	Dell	11	t	2026-07-13 07:15:06.519193
86	MySQL	12	t	2026-07-13 07:15:06.519193
87	Sophos	13	t	2026-07-13 07:15:06.519193
88	Oracle Vault	14	t	2026-07-13 07:15:06.519193
89	ManageEngine	15	t	2026-07-13 07:15:06.519193
90	Pentest Mobile	16	t	2026-07-13 07:15:06.519193
91	Sophos	17	t	2026-07-13 07:15:06.519193
92	FortiPAM	18	t	2026-07-13 07:15:06.519193
93	Jabra	19	t	2026-07-13 07:15:06.519193
94	Interaction Analytics	21	t	2026-07-13 07:15:06.519193
95	Market analysis	24	t	2026-07-13 07:15:06.519193
96	Video conference	25	t	2026-07-13 07:15:06.519193
97	Union	1	t	2026-07-13 07:15:06.519193
98	LinkSys	2	t	2026-07-13 07:15:06.519193
99	Baracuda	3	t	2026-07-13 07:15:06.519193
100	ManageEngine	6	t	2026-07-13 07:15:06.519193
101	AIX	7	t	2026-07-13 07:15:06.519193
102	Azure	8	t	2026-07-13 07:15:06.519193
103	Advantech	9	t	2026-07-13 07:15:06.519193
104	IBM	10	t	2026-07-13 07:15:06.519193
105	Synology	11	t	2026-07-13 07:15:06.519193
106	DB2	12	t	2026-07-13 07:15:06.519193
107	NSX	13	t	2026-07-13 07:15:06.519193
108	IBM QRadar	15	t	2026-07-13 07:15:06.519193
109	Audit	16	t	2026-07-13 07:15:06.519193
110	Kaspersky	17	t	2026-07-13 07:15:06.519193
111	Logitech	19	t	2026-07-13 07:15:06.519193
112	Dev	21	t	2026-07-13 07:15:06.519193
113	Quotation & Proposal	24	t	2026-07-13 07:15:06.519193
114	Call Center	25	t	2026-07-13 07:15:06.519193
115	Infinera	1	t	2026-07-13 07:15:06.519193
116	Huawei	2	t	2026-07-13 07:15:06.519193
117	Citrix	3	t	2026-07-13 07:15:06.519193
118	Trend Micro	6	t	2026-07-13 07:15:06.519193
119	Solaris	7	t	2026-07-13 07:15:06.519193
120	Cloudstack	8	t	2026-07-13 07:15:06.519193
121	IBM	9	t	2026-07-13 07:15:06.519193
122	QNAP	10	t	2026-07-13 07:15:06.519193
123	Zerto	11	t	2026-07-13 07:15:06.519193
124	MongoDB	12	t	2026-07-13 07:15:06.519193
125	OPNSense	13	t	2026-07-13 07:15:06.519193
126	ArcSight	15	t	2026-07-13 07:15:06.519193
127	Incident Response	16	t	2026-07-13 07:15:06.519193
128	Symantec	17	t	2026-07-13 07:15:06.519193
129	VHD	19	t	2026-07-13 07:15:06.519193
130	P&L understanding	24	t	2026-07-13 07:15:06.519193
131	Devops & Cloud	25	t	2026-07-13 07:15:06.519193
132	Moxa	1	t	2026-07-13 07:15:06.519193
133	NETGEAR	2	t	2026-07-13 07:15:06.519193
134	Nessus	6	t	2026-07-13 07:15:06.519193
135	SUSE	7	t	2026-07-13 07:15:06.519193
136	OpenStack	8	t	2026-07-13 07:15:06.519193
137	Oracle	9	t	2026-07-13 07:15:06.519193
138	Synology	10	t	2026-07-13 07:15:06.519193
139	Nakivo	11	t	2026-07-13 07:15:06.519193
140	MilvusDB	12	t	2026-07-13 07:15:06.519193
141	Cisco	13	t	2026-07-13 07:15:06.519193
142	Fluentd	15	t	2026-07-13 07:15:06.519193
143	ManageEngine	17	t	2026-07-13 07:15:06.519193
144	Vinteo	19	t	2026-07-13 07:15:06.519193
145	AI	25	t	2026-07-13 07:15:06.519193
146	Ruckus	1	t	2026-07-13 07:15:06.519193
147	Ruijie	2	t	2026-07-13 07:15:06.519193
148	IBM Cloud	8	t	2026-07-13 07:15:06.519193
149	Neo4j	12	t	2026-07-13 07:15:06.519193
150	Juniper	13	t	2026-07-13 07:15:06.519193
151	Milestone	19	t	2026-07-13 07:15:06.519193
152	Customer Understanding	25	t	2026-07-13 07:15:06.519193
153	Kyland	1	t	2026-07-13 07:15:06.519193
154	VNG Cloud	8	t	2026-07-13 07:15:06.519193
155	Opswat	13	t	2026-07-13 07:15:06.519193
156	Luxriot	19	t	2026-07-13 07:15:06.519193
157	Solution Design	25	t	2026-07-13 07:15:06.519193
158	Netgear	1	t	2026-07-13 07:15:06.519193
159	Hikvision	19	t	2026-07-13 07:15:06.519193
160	Technical Consulting	25	t	2026-07-13 07:15:06.519193
161	Axis	19	t	2026-07-13 07:15:06.519193
162	Proposal Writing/Present	25	t	2026-07-13 07:15:06.519193
163	Dahua	19	t	2026-07-13 07:15:06.519193
164	Support PM & Implement	25	t	2026-07-13 07:15:06.519193
165	HiSharp	19	t	2026-07-13 07:15:06.519193
166	Bid Response	25	t	2026-07-13 07:15:06.519193
167	Technical Proposal	25	t	2026-07-13 07:15:06.519193
168	Clarification Request	25	t	2026-07-13 07:15:06.519193
169	Contract Negotiation	25	t	2026-07-13 07:15:06.519193
\.


--
-- Data for Name: task_groups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_groups (id, phase_id, name, description, status, progress, manday_est, start_date_est, end_date_est, manday_actual, end_date_actual, sort_order, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: task_priorities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_priorities (id, name, kpi_base, color) FROM stdin;
1	Normal	6	🟢 Xanh
2	High	12	🟠 Cam
3	Critical	20	🔴 Đỏ
4	Interrupt	6	🟣 Tím
\.


--
-- Data for Name: task_statuses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_statuses (id, name) FROM stdin;
1	Waiting
2	Process
3	Done
4	Cancel
5	Rework
6	To Do
\.


--
-- Data for Name: tasks_v2; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tasks_v2 (id, task_group_id, task_code, detail, priority, manday_est, status, start_date, assigned_id, support_id, kpi_ratio_assign, kpi_ratio_support, skill_solution_id, skill_vendor_id, ticket_id, remark, send, sort_order, end_date_est, manday_actual, end_date_actual, days_late, kpi_base, kpi_perform, kpi_ot, kpi_final, kpi_assigned, kpi_support, notes, solution, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: teams; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.teams (id, name, description) FROM stdin;
1	Sales	\N
2	Presales	\N
3	Technical	\N
4	Intern L2	\N
5	Intern L1 Tech	\N
6	Developer	\N
7	Marketing	\N
8	Freelancer	\N
9	Back Office	\N
10	Intern L1	\N
\.


--
-- Data for Name: user_skills; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_skills (user_id, skill_id) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, full_name, hashed_pw, role, is_active, "position", department, created_at) FROM stdin;
1	admin@company.com	Admin Company	$2b$12$uX.rRbH1mAAtrExnpymKKukBDZHWjZK48fNPgHMdc3CV7l64VxaV2	admin	t	\N	\N	2026-07-13 07:15:06.519193
\.


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 1, false);


--
-- Name: categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.categories_id_seq', 6, true);


--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customers_id_seq', 5, true);


--
-- Name: departments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.departments_id_seq', 5, true);


--
-- Name: groups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.groups_id_seq', 26, true);


--
-- Name: meeting_members_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.meeting_members_id_seq', 1, false);


--
-- Name: meetings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.meetings_id_seq', 1, false);


--
-- Name: members_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.members_id_seq', 30, true);


--
-- Name: phases_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.phases_id_seq', 1, false);


--
-- Name: platforms_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.platforms_id_seq', 7, true);


--
-- Name: positions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.positions_id_seq', 5, true);


--
-- Name: project_links_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_links_id_seq', 1, false);


--
-- Name: project_members_v2_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_members_v2_id_seq', 1, false);


--
-- Name: projects_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.projects_id_seq', 1, false);


--
-- Name: settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.settings_id_seq', 3, true);


--
-- Name: skills_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.skills_id_seq', 169, true);


--
-- Name: task_groups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_groups_id_seq', 1, false);


--
-- Name: task_priorities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_priorities_id_seq', 4, true);


--
-- Name: task_statuses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_statuses_id_seq', 6, true);


--
-- Name: tasks_v2_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tasks_v2_id_seq', 1, false);


--
-- Name: teams_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.teams_id_seq', 10, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 1, false);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: customers customers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_name_key UNIQUE (name);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: departments departments_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_name_key UNIQUE (name);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: meeting_members meeting_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_members
    ADD CONSTRAINT meeting_members_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: member_skills member_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_skills
    ADD CONSTRAINT member_skills_pkey PRIMARY KEY (member_id, skill_id);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: phases phases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases
    ADD CONSTRAINT phases_pkey PRIMARY KEY (id);


--
-- Name: platforms platforms_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platforms
    ADD CONSTRAINT platforms_name_key UNIQUE (name);


--
-- Name: platforms platforms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platforms
    ADD CONSTRAINT platforms_pkey PRIMARY KEY (id);


--
-- Name: positions positions_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_name_key UNIQUE (name);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: project_links project_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_links
    ADD CONSTRAINT project_links_pkey PRIMARY KEY (id);


--
-- Name: project_members_v2 project_members_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members_v2
    ADD CONSTRAINT project_members_v2_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: settings settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_key_key UNIQUE (key);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);


--
-- Name: task_groups task_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_groups
    ADD CONSTRAINT task_groups_pkey PRIMARY KEY (id);


--
-- Name: task_priorities task_priorities_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_priorities
    ADD CONSTRAINT task_priorities_name_key UNIQUE (name);


--
-- Name: task_priorities task_priorities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_priorities
    ADD CONSTRAINT task_priorities_pkey PRIMARY KEY (id);


--
-- Name: task_statuses task_statuses_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_statuses
    ADD CONSTRAINT task_statuses_name_key UNIQUE (name);


--
-- Name: task_statuses task_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_statuses
    ADD CONSTRAINT task_statuses_pkey PRIMARY KEY (id);


--
-- Name: tasks_v2 tasks_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks_v2
    ADD CONSTRAINT tasks_v2_pkey PRIMARY KEY (id);


--
-- Name: teams teams_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_name_key UNIQUE (name);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: user_skills user_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skills
    ADD CONSTRAINT user_skills_pkey PRIMARY KEY (user_id, skill_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ix_categories_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_categories_id ON public.categories USING btree (id);


--
-- Name: ix_customers_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_customers_id ON public.customers USING btree (id);


--
-- Name: ix_departments_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_departments_id ON public.departments USING btree (id);


--
-- Name: ix_groups_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_groups_id ON public.groups USING btree (id);


--
-- Name: ix_meeting_members_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_meeting_members_id ON public.meeting_members USING btree (id);


--
-- Name: ix_meetings_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_meetings_id ON public.meetings USING btree (id);


--
-- Name: ix_members_display_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_members_display_name ON public.members USING btree (display_name);


--
-- Name: ix_members_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_members_id ON public.members USING btree (id);


--
-- Name: ix_phases_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_phases_id ON public.phases USING btree (id);


--
-- Name: ix_phases_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_phases_project_id ON public.phases USING btree (project_id);


--
-- Name: ix_platforms_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_platforms_id ON public.platforms USING btree (id);


--
-- Name: ix_positions_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_positions_id ON public.positions USING btree (id);


--
-- Name: ix_project_links_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_project_links_id ON public.project_links USING btree (id);


--
-- Name: ix_projects_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_projects_code ON public.projects USING btree (code);


--
-- Name: ix_projects_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_projects_id ON public.projects USING btree (id);


--
-- Name: ix_skills_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_skills_id ON public.skills USING btree (id);


--
-- Name: ix_task_groups_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_groups_id ON public.task_groups USING btree (id);


--
-- Name: ix_task_groups_phase_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_groups_phase_id ON public.task_groups USING btree (phase_id);


--
-- Name: ix_task_priorities_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_priorities_id ON public.task_priorities USING btree (id);


--
-- Name: ix_task_statuses_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_task_statuses_id ON public.task_statuses USING btree (id);


--
-- Name: ix_tasks_v2_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tasks_v2_id ON public.tasks_v2 USING btree (id);


--
-- Name: ix_tasks_v2_task_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tasks_v2_task_group_id ON public.tasks_v2 USING btree (task_group_id);


--
-- Name: ix_teams_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_teams_id ON public.teams USING btree (id);


--
-- Name: groups groups_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: meeting_members meeting_members_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_members
    ADD CONSTRAINT meeting_members_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_members meeting_members_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_members
    ADD CONSTRAINT meeting_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: member_skills member_skills_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_skills
    ADD CONSTRAINT member_skills_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_skills member_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_skills
    ADD CONSTRAINT member_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: phases phases_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phases
    ADD CONSTRAINT phases_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE RESTRICT;


--
-- Name: project_links project_links_platform_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_links
    ADD CONSTRAINT project_links_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.platforms(id) ON DELETE SET NULL;


--
-- Name: project_links project_links_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_links
    ADD CONSTRAINT project_links_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members_v2 project_members_v2_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members_v2
    ADD CONSTRAINT project_members_v2_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: project_members_v2 project_members_v2_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members_v2
    ADD CONSTRAINT project_members_v2_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects projects_pm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pm_id_fkey FOREIGN KEY (pm_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: projects projects_technical_leader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_technical_leader_id_fkey FOREIGN KEY (technical_leader_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: skills skills_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: task_groups task_groups_phase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_groups
    ADD CONSTRAINT task_groups_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES public.phases(id) ON DELETE RESTRICT;


--
-- Name: tasks_v2 tasks_v2_assigned_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks_v2
    ADD CONSTRAINT tasks_v2_assigned_id_fkey FOREIGN KEY (assigned_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: tasks_v2 tasks_v2_skill_solution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks_v2
    ADD CONSTRAINT tasks_v2_skill_solution_id_fkey FOREIGN KEY (skill_solution_id) REFERENCES public.groups(id) ON DELETE SET NULL;


--
-- Name: tasks_v2 tasks_v2_skill_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks_v2
    ADD CONSTRAINT tasks_v2_skill_vendor_id_fkey FOREIGN KEY (skill_vendor_id) REFERENCES public.skills(id) ON DELETE SET NULL;


--
-- Name: tasks_v2 tasks_v2_support_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks_v2
    ADD CONSTRAINT tasks_v2_support_id_fkey FOREIGN KEY (support_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: tasks_v2 tasks_v2_task_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks_v2
    ADD CONSTRAINT tasks_v2_task_group_id_fkey FOREIGN KEY (task_group_id) REFERENCES public.task_groups(id) ON DELETE RESTRICT;


--
-- Name: user_skills user_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skills
    ADD CONSTRAINT user_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: user_skills user_skills_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skills
    ADD CONSTRAINT user_skills_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict NbJaQ2bwdNpOInpLcbgcIKViaXt3kLphq8BeA3gLsHFYSuiSvtyK6u7D0ZXZTxu

