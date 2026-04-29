# Product Requirements Document: DevRev AirSync Connector for Asana

## Document Information

**Product:** DevRev AirSync Connector for Asana  
**Version:** 1.1  
**Date:** December 17, 2025  
**Author:** Dragoslav Radin  
**Status:** Final

---

## 1. Executive Summary

### 1.1 Overview

The DevRev AirSync Connector for Asana enables seamless bidirectional synchronization between Asana and DevRev, allowing organizations to maintain their existing Asana workflows while leveraging DevRev's powerful product development and customer support capabilities. This connector addresses critical market demand from prospects and customers who rely on Asana for project management but want to adopt DevRev for customer-centric product development and agentic workflows.It addresses complex permission mapping between Asana’s object-based model and DevRev’s architecture.

### 1.2 Business Justification

Multiple customers and prospects have explicitly requested Asana integration:

- **Cedar Systems**: Requires Asana integration for dev team collaboration; integration is a blocking requirement for adoption
- **Inner Fit**: Needs to import bug tracking data from Asana into DevRev
- **Multiple prospects**: Requesting data migration from Asana to DevRev
- **Enterprise customers**: Need to surface customer project data from Asana including project stages, statuses, and service offerings

### 1.3 Success Metrics

- History sync can be successfully completed for selected time period
- Periodic differential syncs can be completed successfully
- Zero data loss during synchronization
  - records are successfully created/updated in DevRev or
  - pending records are successfully created in DevRev
- No data corruption during synchronization
- All imported records are usable for the AI agents
  - external source data is populated
  - sync metadata is populated
  - objects and fields descriptions are populated in the schemas
- Permissions are preserved accross all objects after sync

---

## 2. Problem Statement

### 2.1 Customer Pain Points

1. **Data Silos**: Customer project data exists in Asana while product development happens in DevRev, creating disconnected workflows
2. **Manual Data Entry**: Teams manually duplicate information between Asana and DevRev, leading to errors and inefficiency
3. **Adoption Barriers**: Organizations invested in Asana are reluctant to adopt DevRev without integration capabilities
4. **Context Loss**: Development teams lack visibility into customer project status, stages, and health indicators tracked in Asana
5. **Migration Challenges**: No streamlined path to migrate historical project data from Asana to DevRev

### 2.2 Current Workarounds

- Manual copy-paste between systems
- Spreadsheet exports/imports
- Custom scripts using both APIs
- Separate project management in both tools

---

## 4. User Personas

### 4.1 Primary Personas

**Project Manager (Sarah)**

- Manages customer implementation projects in Asana
- Needs visibility into development work in DevRev
- Tracks project stages, status, and health metrics
- Key need: Project data synchronization without changing tools

**Engineering Manager (Marcus)**

- Manages dev team work in both Asana and DevRev
- Needs to connect customer projects to development work
- Tracks bugs, features, and technical work
- Key need: Unified view of customer projects and dev work

**Customer Success Manager (Jennifer)**

- Monitors customer project health in Asana
- Needs to create DevRev tickets based on project issues
- Tracks project milestones and deliverables
- Key need: Automatic ticket creation from Asana tasks

### 4.2 Secondary Personas

**System Administrator (David)**

- Configures and maintains integrations
- Manages data mapping and sync rules
- Monitors sync health and errors
- Key need: Easy configuration and troubleshooting tools

**Executive (Lisa)**

- Needs portfolio-level reporting across both systems
- Tracks OKRs and strategic initiatives
- Reviews project health and resource allocation
- Key need: Consolidated reporting and dashboards

---

## 5. Functional Requirements

### 5.1 Object Type Mapping

#### 5.1.1 Core Object Types (Must Have - P0)

| Asana Object           | DevRev Object          | Bidirectional | Notes                         |
| ---------------------- | ---------------------- | ------------- | ----------------------------- |
| Task                   | Work (Issue/Ticket)    | Yes           | Primary work item mapping     |
| Project                | Enhancemet             | Yes           | Container for related work    |
| User                   | Rev User               | Read-only     | User identity synchronization |
| Comment (Story)        | Comment                | Yes           | Conversation history          |
| Attachment             | Attachment             | Yes           | File attachments              |
| Section                | Stage                  | Read-only     | Stage in stage diagrammapping |
| Subtask                | Sub-issue/Relationship | Yes           | Hierarchical task structure   |
| Tag                    | Tag                    | Yes           | Categorization and filtering  |
| Custom Field           | Custom Field           | Yes           | Extensible metadata           |
| Workspace/Organization | Account/Organization   | Read-only     | Top-level container           |

#### 5.1.2 Extended Object Types (Should Have - P1)

| Asana Object | DevRev Object | Bidirectional | Notes                    |
| ------------ | ------------- | ------------- | ------------------------ |
| Team         | Part          | Read-only     | Organizational structure |
| Milestone    | Milestone     | Read-only     | Key project dates        |

#### 5.1.3 Advanced Object Types (Could Have - P2)

| Asana Object | DevRev Object      | Bidirectional | Notes                  |
| ------------ | ------------------ | ------------- | ---------------------- |
| Portfolio    | Product/Capability | Read-only     | Multi-project grouping |
| Goal         | Objective          | Read-only     | Strategic alignment    |

### 5.2 Task/Work Synchronization

#### 5.2.1 Core Task Fields

**Must synchronize:**

- Task name/title
- Task description/notes
- Assignee (mapped to DevRev user)
- Due date
- Start date
- Completed status
- Created date and creator
- Modified date and modifier
- Priority (mapped to DevRev priority levels)
- Task URL (stored as reference)

#### 5.2.2 Task Relationships

- Parent-child relationships (task-subtask)
- Project membership (multi-homing support)
- Dependencies (blocked by/blocking)
- Followers/watchers

#### 5.2.3 Task States

**Asana Status Mapping to DevRev:**

- Not Started → Backlog/Open
- In Progress → In Progress
- Completed → Closed
- Custom section names → Custom DevRev stages

#### 5.2.4 Multi-homing Support

- **Primary Mapping:** Each Asana task will be mapped to a single "Primary" DevRev Part to maintain hierarchy.
- **Secondary Associations:** Additional project memberships will be synced as **Custom Reference Fields** in DevRev to prevent data duplication while preserving context.

### 5.3 Project Synchronization

#### 5.3.1 Core Project Fields

**Must synchronize:**

- Project name
- Project description/notes
- Project owner
- Project members (team)
- Project status (on track, at risk, off track)
- Project color/visual indicator
- Project privacy settings (public/private)
- Project dates (start date, due date)
- Project custom fields

#### 5.3.2 Project Metadata

- Project layout (list, board, timeline, calendar)
- Project sections/columns
- Default task view settings
- Project archived status

#### 5.3.3 Customer Project Data Requirements

Based on customer feedback, specific project data must be captured:

- **Service offering type** (e.g., Managed Payroll, Managed HR) → Custom field
- **Project stage** (Data Gathering, Project Start, Project Completed) → Stage/Status
- **Project status** (On Track, Off Track, At Risk) → Health indicator
- **Risk indicators** (Off Track Reasons, At Risk Reasons) → Custom fields/comments

### 5.4 Custom Fields Synchronization

#### 5.4.1 Custom Field Type Mapping

| Asana Field Type | DevRev Field Type      | Bidirectional |
| ---------------- | ---------------------- | ------------- |
| Text             | Text                   | Yes           |
| Number           | Number                 | Yes           |
| Single-select    | Single-select          | Yes           |
| Multi-select     | Multi-select           | Yes           |
| Date             | Date                   | Yes           |
| People           | User                   | Yes           |
| Checkbox         | Boolean                | Yes           |
| URL              | URL                    | Yes           |
| Email            | Email                  | Yes           |
| Phone            | Phone                  | Yes           |
| Reference        | Reference/Relationship | Yes           |

#### 5.4.2 Custom Field Scope

- Project-specific custom fields → DevRev subtype custom fields
- Organization-wide custom fields → DevRev app custom fields
- Portfolio custom fields → DevRev portfolio/product custom fields

#### 5.4.3 Custom Field Configuration

- Field name mapping (configurable)
- Field value transformation rules
- Required field validation
- Default values for unmapped fields

### 5.5 Comments and Activity Synchronization

#### 5.5.1 Story/Comment Types

**Must synchronize:**

- Comment stories (user comments)
- Attachment stories (file uploads)
- Task creation stories
- Task completion stories
- Assignment changes
- Due date changes
- Custom field value changes

#### 5.5.2 Comment Metadata

- Comment author (mapped to DevRev user)
- Comment timestamp
- Comment text (with rich text formatting)
- Mentioned users (@ mentions)
- Attached files
- Reactions/likes

#### 5.5.3 Activity History

- Preserve chronological order
- Maintain attribution to original users
- Indicate system-generated vs. user-generated comments
- Include sync metadata (e.g., "Synced from Asana")

### 5.6 Attachment Synchronization

#### 5.6.1 Attachment Types

- Documents (PDF, DOC, DOCX, etc.)
- Images (JPG, PNG, GIF, SVG)
- Spreadsheets (XLS, XLSX, CSV)
- Presentations (PPT, PPTX)
- Code files
- Archives (ZIP, RAR)

#### 5.6.2 Attachment Metadata

- File name
- File size
- File type/MIME type
- Upload date and uploader
- Parent object (task/project)
- View URL (link to original in Asana)

#### 5.6.3 Attachment Handling

- Download and re-upload to DevRev storage
- Maintain original file names and formats
- Support large file handling (up to 100MB)
- Handle attachment deletion/updates

### 5.7 User Mapping and Authentication

#### 5.7.1 User Identity Mapping

- Map Asana users to DevRev users by email address
- Handle users who don't exist in DevRev
- Support guest user mapping
- Handle deactivated/archived users

#### 5.7.2 Unmatched User Handling

**Options for users without DevRev accounts:**

- Create placeholder/bot user
- Map to integration service account
- Skip assignments and notify admin
- Create new DevRev user invitations (with approval)

#### 5.7.3 Authentication Methods

**Asana Authentication:**

- Service Account token (for bot/automation scenarios). Service Accounts are an Enterprise tier feature and can only be created by Asana super admins.
- OAuth 2.0 Authorization Code Grant(recommended for multi-user scenarios)
- Personal Access Token (for single-user/admin scenarios)

### 5.8 Synchronization Modes

#### 5.8.1 Initial Sync (Migration Mode)

**Scope:**

- One-time import of historical data
- Configurable date range (e.g., last 6 months, all time)
- Selective sync (specific projects, tags, users)

**Process:**

1. User initiates sync
2. User selects Asana workspace
3. User configures field mappings
4. System performs import
5. System generates sync report

#### 5.8.2 Incremental Sync (Real-time Mode)

**Scope:**

- Ongoing synchronization of changes
- Polling changes from Asana API

#### 5.8.3 Manual Sync

- User-initiated sync

### 5.9 Field Mapping Configuration

#### 5.9.1 Default Mappings

- Pre-configured mappings for standard fields
- Custom fields mapped to custom fields

### 5.10 Data Filtering and Scope

#### 5.10.1 Time-based Filtering

- Sync only tasks modified after date X

### 5.11 Error Handling and Retry Logic

#### 5.11.1 Error Categories

**Must handle:**

- Authentication errors (invalid token, expired)
- Rate limiting errors (API throttling)
- Network errors (timeouts, connection failures)
- Validation errors (invalid data, missing required fields)
- Permission errors (insufficient access)
- Data conflicts (duplicate keys, constraint violations)

#### 5.11.2 Retry Strategies

- Exponential backoff for transient errors
- Immediate retry for network glitches
- No retry for authentication/permission errors

#### 5.11.3 Error Logging

- Detailed error messages with context
- Error timestamp
- Affected objects and fields
- Stack traces for debugging

### 5.12 Permission Logic

- Guest Access: Guests in Asana have zero visibility by default. The connector will only sync objects explicitly shared with the authenticated Guest user.
- Private Tasks: Tasks not in a project will only sync if the Sync User is the Assignee or a Collaborator.

---

## 6. Non-Functional Requirements

### 6.1 Reliability

#### 6.1.1 Availability

- 99.9% uptime SLA (excluding scheduled maintenance)
- Graceful degradation during partial outages

#### 6.1.2 Data Integrity

- Zero data loss during sync operations
- No data corruption during sync operations
- Modifications made by Asana connector loader must be stored in the modification records

#### 6.1.3 Fault Tolerance

- Automatic recovery from transient failures

### 6.2 Security

#### 6.2.1 Authentication Security

- OAuth 2.0 for user authentication
- Least privilege access principle

#### 6.2.2 Data Security

- Encryption in transit (TLS 1.3)
- Encryption at rest for stored data

### 6.3 Compliance

#### 6.3.1 Data Privacy

- GDPR compliance for EU users
- SOC-2 compliance for financial data
- HIPAA compliance for healthcare data

### 6.4 Usability

#### 6.4.1 Setup Experience

- No snap-in setup

#### 6.4.2 Documentation

- Comprehensive user documentation with table of supported object types with sync direction and their mappings to DevRev objects, and supported permissions sync

### 6.5 Maintainability

#### 6.5.1 Code Quality

- Comprehensive unit test coverage > 80%
- Integration test suite with mock Asana server
- Score of AI Code review tool > 90%
- use of latest @devrev/adaas-ts SDK GA version

#### 6.5.2 Monitoring and Debugging

- Structured logging
- Distributed tracing
- Performance profiling tools
- Debug mode for troubleshooting

#### 6.5.3 Upgradability

- Backward compatible changes
- Zero-downtime deployments

---

## 8. API & Integration Specifications

### 8.1 Asana API Integration

#### 8.1.1 API Version

- Use Asana API v1.0
- Base URL: https://app.asana.com/api/1.0

#### 8.1.2 Required API Endpoints

**Tasks:**

- GET /tasks - List tasks
- GET /tasks/{task_gid} - Get task details
- POST /tasks - Create task
- PUT /tasks/{task_gid} - Update task
- DELETE /tasks/{task_gid} - Delete task

**Projects:**

- GET /projects - List projects
- GET /projects/{project_gid} - Get project details
- POST /projects - Create project
- PUT /projects/{project_gid} - Update project

**Users:**

- GET /users - List users
- GET /users/{user_gid} - Get user details

**Custom Fields:**

- GET /custom_fields - List custom fields
- GET /custom_field_settings/project/{project_gid} - Get project custom fields

**Stories (Comments):**

- GET /tasks/{task_gid}/stories - List task stories
- POST /tasks/{task_gid}/stories - Create story

**Attachments:**

- GET /attachments/{attachment_gid} - Get attachment
- POST /attachments - Create attachment

#### 8.1.3 API Rate Limits

- Standard rate limit: 1,500 requests per minute
- Premium rate limit: 1,500 requests per minute
- Implement exponential backoff
- Use batch endpoints where available

### 8.2 DevRev API Integration

#### 8.2.1 Required API Endpoints

**Works:**

- POST /works.create - Create work item
- POST /works.update - Update work item
- POST /works.get - Get work item
- POST /works.list - List work items

**Parts (Projects):**

- POST /parts.create - Create part
- POST /parts.update - Update part
- POST /parts.get - Get part

**Rev Users:**

- POST /rev-users.list - List users
- POST /rev-users.get - Get user

**Comments:**

- POST /timeline-entries.create - Create comment

**Attachments:**

- POST /artifacts.prepare - Prepare upload
- POST /artifacts.upload - Upload file

#### 8.2.2 Custom Fields

- Use DevRev custom fields API
- Schema definition for custom fields
- Field value validation

### 8.3 Data Transformation Layer

#### 8.3.1 Object Mapping Engine

- Pluggable transformation rules
- Schema validation
- Type conversion
- Null/default value handling

#### 8.3.2 Data Enrichment

- Add metadata tags (e.g., "source:asana")
- Generate external IDs for traceability
- Timestamp all synced objects
- Track sync version/history

---

## 12. Success Criteria

### 12.1 Launch Criteria

#### 12.1.1 Functional Completeness

- ✅ All P0 object types supported (Tasks, Projects, Users, Comments, Attachments)
- ✅ Bidirectional sync (Asana → DevRev and DevRev → Asana) working reliably
- ✅ Custom fields mapping for at least 10 common field types
- ✅ Initial bulk migration tested with 10,000+ tasks
- ✅ User mapping with email-based matching

#### 12.1.2 Quality Gates

- ✅ < 1% data loss during synchronization
- ✅ < 5% sync failures in beta testing
- ✅ Zero critical security vulnerabilities
- ✅ 80%+ unit test coverage
- ✅ Passed integration test suite
- ✅ AI code review score > 90%
- ✅ Load testing with 100,000 objects completed

#### 12.1.3 User Validation

- ✅ 4 customers successfully syncing Asana
- ✅ < 10 P0/P1 bugs identified in beta
- ✅ Documentation approved by technical doc writer
- ✅ Support team trained and ready

### 12.3 Risks and Mitigation

#### 12.3.1 Technical Risks

**Risk: Asana permissions model cant be mapped to DevRev**

- Likelihood: High
- Impact: Very High
- Mitigation: Flaten hierarchical permissions to group-based
- Contingency: Document limitations, provide manual workarounds

**Risk: Asana API rate limiting impacts sync performance**

- Likelihood: Medium
- Impact: High
- Mitigation: Implement intelligent rate limiting, request batching, and premium API tier upgrade
- Contingency: Add configurable sync frequency, implement priority queuing

**Risk: Data model mismatches between Asana and DevRev**

- Likelihood: Medium
- Impact: Medium
- Mitigation: Flexible mapping engine, custom transformation rules, extensive testing
- Contingency: Document unsupported scenarios, provide manual workarounds

**Risk: Large attachment files impact performance**

- Likelihood: Medium
- Impact: Medium
- Mitigation: Async file processing, size limits, streaming uploads
- Contingency: Link-only mode for large files, user notification for failed uploads

**Risk: Complex subtask hierarchies cause sync issues**

- Likelihood: Low
- Impact: Medium
- Mitigation: Depth limit (2 levels), iterative sync algorithm, hierarchy validation
- Contingency: Flatten complex hierarchies, notify admins of unsupported structures

#### 12.3.2 Business Risks

**Risk: Customers unwilling to change Asana workflows**

- Likelihood: Medium
- Impact: High
- Mitigation: Minimal workflow disruption, bidirectional sync, extensive documentation
- Contingency: Phased migration approach, hybrid usage support, change management services

**Risk: Competitive integrations emerge**

- Likelihood: Medium
- Impact: Medium
- Mitigation: Fast time to market, superior user experience, continuous improvement
- Contingency: Feature differentiation, bundle with other DevRev value props

**Risk: Insufficient customer demand**

- Likelihood: Low
- Impact: High
- Mitigation: Pre-validated with customer requests, pipeline analysis shows demand
- Contingency: Pivot to other high-demand integrations, maintain minimal support mode

**Risk: Support burden exceeds capacity**

- Likelihood: Medium
- Impact: Medium
- Mitigation: Comprehensive self-service tools, proactive monitoring, automated diagnostics
- Contingency: Expand support team, community-driven support, partner with Asana support

#### 12.3.3 Operational Risks

**Risk: Security vulnerability in integration**

- Likelihood: Low
- Impact: Critical
- Mitigation: Security review, penetration testing, secure coding practices, token encryption
- Contingency: Immediate patch release, customer notification, temporary service suspension if needed

**Risk: Regulatory compliance issues (GDPR/HIPAA)**

- Likelihood: Low
- Impact: High
- Mitigation: Legal review, privacy impact assessment, data processing agreements
- Contingency: Geographic restrictions, enhanced compliance controls, customer notifications

**Risk: Vendor API changes break integration**

- Likelihood: Medium
- Impact: High
- Mitigation: API versioning, deprecation monitoring, automated compatibility testing
- Contingency: Rapid hotfix capability, customer communication, fallback to previous API version

---

## 13. Dependencies

### 13.1 Internal Dependencies

#### 13.1.1 Platform Teams

- **MFZ Team**: Permission model mapping and permissions hierarchy implementation
- **Agent Team**: Readines for Asana objects
- **S3Interact Team**: Attachment storage
- **MELTS Team**: Observability infrastructure, alerting setup

#### 13.1.2 Product Teams

- **Parts Team**: Project/Part mapping and synchronization
- **Identity Team**: Rev User identity merging
- **Platform UI Team**: Configuration UI

#### 13.1.3 Support Functions

- **Documentation Team**: User documentaion review
- **Support Team**: Training, runbooks, escalation procedures
- **Sales and SE Teams**: Demo environments, usage videos

### 13.2 External Dependencies

#### 13.2.1 Asana

- API stability and availability (99.9% SLA)
- OAuth app approval process
- API rate limit quotas
- Premium API tier access (if needed)

#### 13.2.2 Third-party Services

- **Cloud Infrastructure**: AWS/GCP for compute and storage
- **CDN**: Cloudflare or similar for attachment delivery
- **Monitoring**: Datadog or similar for observability
- **Secret Management**: Vault or AWS Secrets Manager

### 13.3 Timeline Dependencies

| Milestone         | Dependency               | Required Date | Status   |
| ----------------- | ------------------------ | ------------- | -------- |
| Alpha Release     | AirSync Core v2.0        | Month 2       | On Track |
| Beta Release      | DevRev Custom Fields API | Month 3       | At Risk  |
| GA Release        | OAuth Infrastructure     | Month 5       | On Track |
| Advanced Features | Portfolio API            | Month 7       | TBD      |

---

## 14. Questions & Decisions

### 14.1 Technical Questions & Decisions

1. **Q: What's the approach for Asana approvals workflow?**

   - Options: (a) Not supported in v1 (b) Map to custom field (c) Custom approval workflow in DevRev
   - Decision: (a) Not supported in v1

2. **Q: Should we support Asana's automation rules?**
   - Options: (a) Out of scope (b) One-way migration to DevRev automations (c) Bidirectional automation sync
   - Decision: (a) Out of scope

### 14.2 Business Questions & Decisions

1. **Q: What's the pricing model for the Asana connector?**
   - Options: (a) Included in AirSync (b) Separate SKU (c) Usage-based pricing
   - Decision needed by: Month 3
   - Decision maker: Product Management + Sales Leadership

---

## 15. Assumptions

### 15.1 Technical Assumptions

1. Asana API will remain stable and backward compatible during development
2. DevRev platform can handle increased API load from sync operations
3. Average Asana workspace has < 50,000 active tasks
4. Most custom fields will map cleanly to DevRev field types
5. Majority of users can be mapped via email address
6. Attachment sizes typically < 25MB (95th percentile)
7. Network latency between Asana and DevRev APIs < 500ms

### 15.2 Business Assumptions

1. Customer demand remains strong through development cycle
2. Asana will not block or restrict API access for integrations
3. No major competitive integration launches during development
4. Sales team can effectively demo and sell the integration
5. Customers willing to accept 5-minute sync latency
6. Support team capacity sufficient for expected volume
7. Marketing can generate awareness and demand
8. Pricing model will be competitive and acceptable to customers

### 15.3 User Assumptions

1. Users have admin access to both Asana and DevRev
2. Users willing to invest 15-30 minutes in initial setup
3. Users comfortable with occasional sync conflicts
4. Users will follow data hygiene best practices
5. Users understand limitations of cross-platform sync
6. Users have stable internet connectivity
7. Users can tolerate initial sync taking several hours for large datasets

---

## 16. Glossary

| Term                    | Definition                                                    |
| ----------------------- | ------------------------------------------------------------- |
| **AirSync**             | DevRev's integration platform for connecting external systems |
| **Bidirectional Sync**  | Two-way synchronization where changes flow in both directions |
| **Custom Field**        | User-defined field for capturing domain-specific data         |
| **GID**                 | Global ID - Asana's unique identifier for objects             |
| **Incremental Sync**    | Ongoing synchronization of only changed objects               |
| **Multi-homing**        | Asana feature allowing tasks to belong to multiple projects   |
| **Object Type**         | Category of data (e.g., Task, Project, User)                  |
| **Portfolio**           | Asana's container for grouping multiple projects              |
| **Section**             | Grouping within an Asana project (like swimlanes)             |
| **Story**               | Asana's term for activity/comment entries                     |
| **Subtask**             | Task that is a child of another task                          |
| **Sync Conflict**       | Situation where same object modified in both systems          |
| **Sync Latency**        | Time delay between change and synchronization                 |
| **Unidirectional Sync** | One-way synchronization (source to target only)               |
| **Work**                | DevRev's term for work items (issues, tickets, tasks)         |
| **Workspace**           | Top-level organizational container in Asana                   |

---

## 17. Appendices

### 17.1 Appendix A: Customer Use Cases

#### Use Case 1: Customer Implementation Projects (Cedar Systems)

**Actors:** Project Manager, Customer Success Manager, Engineering Team
**Goal:** Track customer onboarding projects in Asana while connecting to development work in DevRev

**Flow:**

1. PM creates customer project in Asana with stages: Discovery, Implementation, Launch
2. Project syncs to DevRev as a Part/Project
3. Customer requests during implementation create tasks in Asana
4. Tasks sync to DevRev as work items assigned to engineering
5. Engineers update status in DevRev
6. Status syncs back to Asana for PM visibility
7. PM tracks overall project health in Asana dashboard

**Requirements:**

- Project stage synchronization
- Custom fields for customer name, project type, health status
- Bidirectional task status sync
- Comment synchronization for collaboration

#### Use Case 2: Bug Tracking Migration (Inner Fit)

**Actors:** QA Team, Development Team, Product Manager
**Goal:** Migrate all historical bug data from Asana to DevRev

**Flow:**

1. Admin identifies all bug-tagged tasks in Asana (3,000+ tasks)
2. Admin configures bulk import with date range: last 2 years
3. System performs initial sync of all bug tasks
4. Custom fields map: Bug Severity → Priority, Bug Type → Category
5. All comments and attachments migrate
6. Team validates data accuracy
7. QA team transitions to DevRev for new bugs
8. Historical bugs remain accessible in DevRev

**Requirements:**

- Bulk historical data import
- Tag-based filtering
- Custom field mapping
- Complete activity history preservation
- Attachment migration

#### Use Case 3: Cross-functional Product Development

**Actors:** Product Manager, Engineering Team, Design Team, Marketing Team
**Goal:** Coordinate product development across teams using both tools

**Flow:**

1. Product Manager plans features in Asana with marketing and design
2. Features sync to DevRev for engineering implementation
3. Engineers break down features into technical tasks in DevRev
4. Task status updates flow back to Asana
5. Design team adds mockups as attachments in Asana
6. Attachments sync to DevRev for engineering reference
7. PM tracks overall roadmap in Asana, technical progress in DevRev

**Requirements:**

- Feature/epic level synchronization
- Bidirectional status updates
- Attachment synchronization
- Team visibility across both systems
- Roadmap alignment

### 17.2 Appendix B: Field Mapping Examples

#### Standard Task Field Mapping

| Asana Field   | DevRev Field  | Transform     | Notes                |
| ------------- | ------------- | ------------- | -------------------- |
| name          | title         | Direct        | 255 char limit       |
| notes         | description   | Direct        | Preserve markdown    |
| assignee.gid  | owner_id      | User lookup   | Map by email         |
| due_on        | due_date      | Date format   | ISO 8601             |
| start_on      | start_date    | Date format   | ISO 8601             |
| completed     | stage         | Status map    | Completed → Closed   |
| completed_at  | closed_date   | Date format   | ISO 8601             |
| tags          | tags          | Array map     | Create if not exists |
| custom_fields | custom_fields | Type-specific | See below            |
| followers     | subscribers   | User lookup   | Map by email         |
| created_at    | created_date  | Date format   | Read-only            |
| modified_at   | modified_date | Date format   | System managed       |
| permalink_url | external_ref  | URL           | Link to Asana        |

#### Custom Field Type Mapping

| Asana Type    | Example         | DevRev Type   | Transform       |
| ------------- | --------------- | ------------- | --------------- |
| text          | "High priority" | text          | Direct          |
| number        | 42.5            | number        | Direct          |
| enum (single) | "In Progress"   | single_select | Map enum values |
| multi_enum    | ["Bug", "UI"]   | multi_select  | Map enum values |
| date          | "2025-12-31"    | date          | ISO 8601        |
| people        | user_gid        | user          | User lookup     |

#### Project Field Mapping

| Asana Field   | DevRev Field      | Transform     | Notes           |
| ------------- | ----------------- | ------------- | --------------- |
| name          | name              | Direct        |                 |
| notes         | description       | Direct        |                 |
| owner         | owner_id          | User lookup   |                 |
| team          | part_type         | Constant      | "product"       |
| color         | metadata          | JSON          | Custom styling  |
| archived      | archived          | Boolean       |                 |
| public        | visibility        | Enum          | public/private  |
| due_date      | target_close_date | Date format   |                 |
| start_on      | target_start_date | Date format   |                 |
| custom_fields | custom_fields     | Type-specific |                 |
| members       | members           | User array    | Team membership |

### 17.3 Appendix D: Error Code Reference

| Error Code      | Description              | User Action      | System Action       |
| --------------- | ------------------------ | ---------------- | ------------------- |
| ASANA_AUTH_001  | Invalid OAuth token      | Re-authenticate  | Notify admin        |
| ASANA_AUTH_002  | Token expired            | Refresh token    | Auto-refresh        |
| ASANA_RATE_001  | Rate limit exceeded      | Wait             | Exponential backoff |
| ASANA_PERM_001  | Insufficient permissions | Grant access     | Log and notify      |
| ASANA_NOT_FOUND | Object not found         | Verify exists    | Skip sync           |
| DEVREV_API_001  | DevRev API error         | Check status     | Retry with backoff  |
| MAPPING_001     | Field mapping failed     | Review mapping   | Log for review      |
| MAPPING_002     | Required field missing   | Provide value    | Use default         |
| CONFLICT_001    | Sync conflict detected   | Resolve manually | Log conflict        |
| VALIDATION_001  | Data validation failed   | Fix data         | Log error           |

### 17.4 Appendix E: API Rate Limit Strategy

#### Request Prioritization

| Priority | Use Case            | Rate Allocation |
| -------- | ------------------- | --------------- |
| P1       | User-initiated sync | 80% of quota    |
| P2       | Scheduled sync      | 70% of quota    |
| P3       | Background tasks    | 10% of quota    |

#### Rate Limit Handling

```
IF rate_limit_exceeded THEN
  wait_time = initial_delay * (2 ^ attempt_count)
  WAIT(min(wait_time, max_delay))
  RETRY request
END IF
```

### 17.5 Appendix F: Asana Object Hierarchy

![Asana Object Hierarchy ](asana-object-hierarchy-original.png)
![Asana Domain Objects](asana-object-hierarchy.png)

### 17.6 Appendix G: Asana Permissions & Access Mode

This appendix provides a comprehensive analysis of the Asana permissions model to support the product requirements for your integration. Asana uses an **object-based permission system**, where access is defined by the user's relationship to specific containers (Organizations, Teams, Projects, and Tasks).

#### 17.6.1 Hierarchy & Organizational Objects

Asana’s permissions flow through a hierarchy. Access to a "lower" object (like a task) is often inherited from a "higher" object (like a project), but can also be granted explicitly.

##### A. Organization & Workspace

- **Organization:** The highest level, defined by a company email domain (e.g., `@company.com`).
- **Workspace:** A collection of people collaborating without a common email domain (used by small teams or for personal work).
- **Member Types:**
- **Members:** Users with the company domain. They can discover and join public teams/projects.
- **Guests:** Users without the company domain (e.g., contractors). They have **zero visibility** by default and only see objects explicitly shared with them.

##### B. Teams

Teams are the primary way to manage groups of users and their access to multiple projects.

- **Privacy Settings:**
- **Public to Organization:** Any organization member can see and join without approval.
- **Membership by Request:** Visible to organization members, but they must be approved to join.
- **Private:** Hidden from everyone except invited members.

- **Team Roles:**
- **Team Admin:** Can manage team settings, members, and delete the team.
- **Team Member:** Access to all projects shared with that team.

#### 17.6.2 Project Permissions (Object-Level)

Projects are the most complex permission layer. Permissions are **additive**: if a user is both a Team Member (Editor) and an individual Project Member (Commenter), they keep the higher "Editor" permission.

##### A. Access Levels

| Role              | Capabilities                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Project Admin** | Full control: delete/archive project, change privacy settings, manage memberships, and edit all workflows.                |
| **Editor**        | Can add/edit/delete tasks, change task details, and edit project overviews. Cannot delete the project or change privacy.  |
| **Commenter**     | Can only view and comment on tasks. They cannot change assignees, due dates, or task titles unless they are the assignee. |
| **Viewer**        | Read-only access. Can see everything but cannot comment or edit.                                                          |

##### B. Privacy Settings

- **Private to Members:** Only explicitly invited people/teams can see the project.
- **Shared with Team:** All members of the parent team can access it.
- **Shared with Organization:** Anyone in the company can search for and join this project.

---

#### 17.6.3 Task Permissions

Tasks are the "atomic" unit of work. Visibility usually depends on the parent project, but there are exceptions:

- **Inheritance:** If a user has access to a project, they have access to every task in it.
- **Direct Access (Task Collaborators):** A user can be added to a single task without having access to the rest of the project. They will see that task and its subtasks only.
- **Multi-homing:** A task can live in multiple projects. If a user has access to _at least one_ of those projects, they can see the task.
- **Private Tasks:** A task not associated with any project is visible only to the creator, the assignee, and any added collaborators.

#### 17.6.4 Specialized Object Permissions

##### A. Portfolios (Enterprise Feature)

- **Privacy:** Portfolios can be "Private to members" or "Shared with organization."
- **Access:** Access to a portfolio does **not** automatically grant access to the projects within it. Users see a "Private Project" placeholder if they lack project-level permissions.

##### B. Goals (Advanced/Enterprise)

- **Access Levels:** Admin, Editor, Commenter, Viewer.
- **Visibility:** Can be public to the organization or private to specific members.

##### C. Rules & Automations

- **Ownership:** Rules are owned by the creator.
- **Editing:** Only project members with "Edit" or "Admin" permissions can modify rules.
- **External Triggers:** Rules with external app triggers (like Slack or Jira) can typically only be edited by the rule owner.

#### 17.6.5 Global Sharing Rules & Policies

##### A. Admin Console Policies (Super Admin)

For an integration, you must respect these global domain-wide settings:

- **Guest Invite Policy:** Admins can restrict who can invite guests (Admins only vs. Everyone).
- **App Approval Policy:** Admins can "Allow-list" specific integrations, meaning your app may require manual approval by an IT admin before any user can connect.
- **Read-Only Link Sharing:** Admins can disable the ability for users to create public "Read-only" links for projects.
- **Work Access Mode:** A specific "Super Admin" state that allows them to view all private data for security or offboarding purposes.

##### B. API-Specific Scopes (OAuth)

When integrating, Asana requires **OAuth Scopes** to limit the app's power. Your integration must request only what it needs:

- `default`: Full access to the user's data.
- `tasks:read` / `tasks:write`: Specific to task manipulation.
- `projects:read` / `projects:write`: Specific to project data.
- `openid` / `email` / `profile`: For authentication and identity mapping.

#### 17.6.6 Integration Constraints Checklist

- **The "Double Gate" Rule:** To perform an action via the API, the user must have both the **OAuth scope** for the action AND the **Asana object permission** for that specific item.
- **Multi-Homing Risks:** Be aware that adding a task to a second project might inadvertently expose it to new people if that project is "Shared with Organization."
- **Guest Constraints:** Guests cannot create or own Portfolios or Goals in most configurations and cannot see "Public" teams unless invited.

---

## Document Control

| Version | Date       | Author          | Changes                |
| ------- | ---------- | --------------- | ---------------------- |
| 0.1     | 2025-10-12 | Dragoslav Radin | Initial draft          |
| 1.0     | 2025-10-14 | Dragoslav Radin | Final draft for review |
| 1.1     | 2025-12-17 | Dragoslav Radin | Final                  |

---

_End of Product Requirements Document_
