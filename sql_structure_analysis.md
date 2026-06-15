# 📊 Database Schema Deep Analysis

Source Backup: `c:\Users\DELL\Downloads\absteqwc_absservice (2).sql`

Total Tables Discovered: **54**

## 🗂️ Table Index
- [`admin`](#table-admin)
- [`amcdetails`](#table-amcdetails)
- [`app_open_close_details`](#table-app_open_close_details)
- [`bank`](#table-bank)
- [`billing`](#table-billing)
- [`billingcompany`](#table-billingcompany)
- [`billingitem`](#table-billingitem)
- [`broadcast`](#table-broadcast)
- [`calling`](#table-calling)
- [`clouddetails`](#table-clouddetails)
- [`cloud_activities`](#table-cloud_activities)
- [`cloud_audit_logs`](#table-cloud_audit_logs)
- [`cloud_mappings`](#table-cloud_mappings)
- [`cloud_pincodes`](#table-cloud_pincodes)
- [`cloud_servers`](#table-cloud_servers)
- [`cloud_tdl_master`](#table-cloud_tdl_master)
- [`cloud_tdl_requirements`](#table-cloud_tdl_requirements)
- [`cloud_tdl_tasks`](#table-cloud_tdl_tasks)
- [`cloud_tdl_task_history`](#table-cloud_tdl_task_history)
- [`cloud_users`](#table-cloud_users)
- [`cloud_user_sessions`](#table-cloud_user_sessions)
- [`cloud_visits`](#table-cloud_visits)
- [`custom`](#table-custom)
- [`customer`](#table-customer)
- [`customerupdate`](#table-customerupdate)
- [`customer_contact_details`](#table-customer_contact_details)
- [`customer_contact_mapping_data`](#table-customer_contact_mapping_data)
- [`entry`](#table-entry)
- [`expensecommission`](#table-expensecommission)
- [`expensepayment`](#table-expensepayment)
- [`group_change_history`](#table-group_change_history)
- [`history`](#table-history)
- [`office_check_in_out_details`](#table-office_check_in_out_details)
- [`office_check_in_out_details_new`](#table-office_check_in_out_details_new)
- [`OldTallyDataBills`](#table-oldtallydatabills)
- [`payment`](#table-payment)
- [`pincode`](#table-pincode)
- [`product`](#table-product)
- [`reseller`](#table-reseller)
- [`servicecall`](#table-servicecall)
- [`service_calls`](#table-service_calls)
- [`singlemaster`](#table-singlemaster)
- [`state`](#table-state)
- [`tallydetails`](#table-tallydetails)
- [`task`](#table-task)
- [`tdldetails`](#table-tdldetails)
- [`tdl_master`](#table-tdl_master)
- [`tdl_requirements`](#table-tdl_requirements)
- [`usercheck`](#table-usercheck)
- [`userproductmap`](#table-userproductmap)
- [`user_checkin_checkout_details`](#table-user_checkin_checkout_details)
- [`user_checkin_checkout_details_new`](#table-user_checkin_checkout_details_new)
- [`user_locations`](#table-user_locations)
- [`user_location_history`](#table-user_location_history)

---

## Table: `admin`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `name` | varchar(255) DEFAULT NULL |
| `checkin` | varchar(12) NOT NULL DEFAULT 'No' |
| `username` | varchar(255) NOT NULL |
| `password` | varchar(20) NOT NULL |
| `mobile` | varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `search` | varchar(255) NOT NULL DEFAULT 'YES' |
| `active` | varchar(20) NOT NULL DEFAULT 'YES' |
| `mac` | varchar(255) NOT NULL DEFAULT '99' |
| `date` | text CHARACTER SET latin1 COLLATE latin1_swedish_ci |
| `ga_code` | text CHARACTER SET latin1 COLLATE latin1_swedish_ci |
| `qr_code` | text CHARACTER SET latin1 COLLATE latin1_swedish_ci |
| `attendance` | varchar(20) DEFAULT 'NO' |
| `account` | varchar(25) NOT NULL DEFAULT 'NO' |
| `approval` | varchar(25) NOT NULL DEFAULT 'NO' |
| `commission` | varchar(20) NOT NULL DEFAULT 'NO' |
| `showcloudpass` | varchar(20) NOT NULL DEFAULT 'NO' |
| `serviceadmin` | varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `reselleradmin` | varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `office_id` | int NOT NULL DEFAULT '0' |
| `other_location` | enum('Yes','No') NOT NULL DEFAULT 'No' |
| `device_id` | text CHARACTER SET latin1 COLLATE latin1_swedish_ci |
| `service_type` | enum('TDL','Tally','Cloud') NOT NULL DEFAULT 'Tally' |

## Table: `amcdetails`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `customerid` | int NOT NULL |
| `cycle` | varchar(255) NOT NULL |
| `amount` | int NOT NULL |
| `amcserial` | varchar(255) NOT NULL |
| `amcexpiry` | date NOT NULL |
| `productid` | int NOT NULL |
| `status` | varchar(255) NOT NULL |
| `inactive_date` | date NOT NULL |
| `tempid` | varchar(255) NOT NULL |

## Table: `app_open_close_details`
| Column | Definition |
| :--- | :--- |
| `id` | bigint NOT NULL |
| `user_id` | bigint NOT NULL COMMENT 'admin table primary key' |
| `date` | date NOT NULL |
| `open_time` | time NOT NULL |
| `close_time` | time DEFAULT NULL |
| `status` | enum('Active','Inactive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Active' |
| `created_at` | datetime NOT NULL |
| `updated_at` | datetime NOT NULL DEFAULT '0000-00-00 00:00:00' |

## Table: `bank`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `name` | varchar(255) NOT NULL |

## Table: `billing`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `voucher` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'Sales' |
| `bill_type` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'Tally' |
| `billingcompany` | int DEFAULT '1' |
| `company` | int DEFAULT NULL |
| `status` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `invoice_no` | varchar(255) DEFAULT NULL |
| `invoice_date` | date DEFAULT '2000-01-01' |
| `discount` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT '0' |
| `totalamount` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `totalcommission` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `totalcdiscount` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `totalwithoutgst` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `cgst` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `sgst` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `igst` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `totalwithgst` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `added_by` | int DEFAULT NULL |
| `date_added` | date DEFAULT '2000-01-01' |
| `approve_by` | int DEFAULT NULL |
| `pstatus` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'Pending' |
| `task` | varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'Yes' |
| `tally` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'No' |
| `next_type` | varchar(50) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `next_date` | date DEFAULT '2000-01-01' |
| `remarks` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `masterID` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `refno` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `refdate` | date DEFAULT '2000-01-01' |
| `email` | varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'No' |
| `cron_date` | date DEFAULT '2024-04-01' |
| `no_of_followups` | int DEFAULT NULL |
| `pay_type` | varchar(20) DEFAULT NULL |
| `pay_date` | date DEFAULT NULL |
| `pay_remark` | varchar(200) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |

## Table: `billingcompany`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `name` | varchar(255) NOT NULL |
| `email` | varchar(255) NOT NULL |
| `mobile` | varchar(255) NOT NULL |
| `address1` | text NOT NULL |
| `address2` | text NOT NULL |
| `city` | varchar(255) NOT NULL |
| `state` | int NOT NULL |
| `pincode` | varchar(255) NOT NULL |
| `gstin` | varchar(255) NOT NULL |
| `domain` | text NOT NULL |
| `date` | date NOT NULL |
| `bank_acc_name` | varchar(255) NOT NULL |
| `bank_name` | varchar(255) NOT NULL |
| `bank_branch` | varchar(255) NOT NULL |
| `bank_ifsc` | varchar(255) NOT NULL |
| `bank_acc` | varchar(255) NOT NULL |

## Table: `billingitem`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `productid` | int DEFAULT NULL |
| `serialid` | int DEFAULT NULL |
| `expiry` | date DEFAULT NULL |
| `newexpiry` | date DEFAULT NULL |
| `incrate` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `rate` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `qty` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `amount` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `commission` | int DEFAULT NULL |
| `cstatus` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'UNPAID' |
| `cdiscount` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `remark` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `billingid` | int DEFAULT NULL |

## Table: `broadcast`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `type` | varchar(50) NOT NULL |
| `name` | varchar(255) NOT NULL |
| `mobile` | varchar(20) NOT NULL |
| `addedby` | int NOT NULL |
| `date` | date NOT NULL |
| `broadcastid` | int NOT NULL DEFAULT '0' |

## Table: `calling`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `customer_id` | int NOT NULL COMMENT 'customer table' |
| `user_id` | int NOT NULL COMMENT 'admin table' |
| `call_number` | varchar(22) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL |
| `type` | enum('Service Call','Normal Call','Lead','Customisation','Renewal Follow Up','Payment Follow Up','') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL |
| `type_id` | bigint NOT NULL DEFAULT '0' |
| `remark` | varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' |
| `followup_date` | date NOT NULL DEFAULT '0000-00-00' |
| `followup_type` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' |
| `serial_bill_no` | varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL |
| `date` | datetime NOT NULL |
| `call_type` | enum('Caller','Receiver','Missed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL |
| `start_time` | bigint NOT NULL DEFAULT '0' COMMENT 'in miliseconds' |
| `end_time` | bigint NOT NULL DEFAULT '0' COMMENT 'in miliseconds' |
| `duration` | time NOT NULL DEFAULT '00:00:00' |
| `status` | enum('Active','Inactive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Active' |
| `inserted_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP |
| `rejected` | varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'No' |
| `remark_status` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL |

## Table: `clouddetails`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `cloud_act` | date DEFAULT NULL |
| `cloud_rate` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `extra_hour` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `cloud_type` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `cloud_serial` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `cloud_expiry` | date DEFAULT NULL |
| `cloud_username` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `cloud_password` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `cloud_users` | int DEFAULT NULL |
| `cloud_period` | varchar(255) NOT NULL DEFAULT 'Monthly' |
| `tallyserial` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `customerid` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `tempid` | varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL |
| `date_added` | date DEFAULT NULL |
| `active_status` | varchar(255) NOT NULL DEFAULT 'Active' |
| `inactive_date` | date DEFAULT NULL |

## Table: `cloud_activities`
| Column | Definition |
| :--- | :--- |
| `id` | varchar(50) COLLATE utf8mb3_unicode_ci NOT NULL |
| `display_id` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `customer_id` | int DEFAULT NULL |
| `customer_name` | varchar(150) COLLATE utf8mb3_unicode_ci NOT NULL |
| `customer_domain_ip` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `server_name` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `sof_no` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `activity_date` | date NOT NULL |
| `activity_type` | enum('New','Renewal','User') COLLATE utf8mb3_unicode_ci NOT NULL |
| `bill_type` | enum('Tax Invoice','Credit Note') COLLATE utf8mb3_unicode_ci NOT NULL |
| `billing_units` | int DEFAULT '0' |
| `purchase_units` | int DEFAULT '0' |
| `last_bill_rate` | decimal(10,2) DEFAULT NULL |
| `purchase_rate` | decimal(10,2) DEFAULT NULL |
| `billing_cycle` | enum('Monthly','Quarterly','Half-Yearly','Yearly') COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `old_expiry_date` | date DEFAULT NULL |
| `start_from` | date DEFAULT NULL |
| `new_expiry_date` | date DEFAULT NULL |
| `date_diff_months` | int DEFAULT '0' |
| `date_diff_days` | int DEFAULT '0' |
| `bill_amount` | decimal(12,2) NOT NULL DEFAULT '0.00' |
| `purchase_amount` | decimal(12,2) DEFAULT '0.00' |
| `record_nature` | enum('Sales','Purchase') COLLATE utf8mb3_unicode_ci DEFAULT 'Sales' |
| `group_id` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `billing_mode` | enum('day_to_day','month_to_month') COLLATE utf8mb3_unicode_ci DEFAULT 'day_to_day' |
| `custom_period` | tinyint(1) DEFAULT '0' |
| `is_purchase` | tinyint(1) DEFAULT '0' |
| `billing_activity_type` | enum('New','Renewal','User') COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `purchase_activity_type` | enum('New','Renewal','User') COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `purchase_billing_mode` | enum('day_to_day','month_to_month') COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `purchase_cycle` | enum('Monthly','Quarterly','Half-Yearly','Yearly') COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `purchase_start_from` | date DEFAULT NULL |
| `purchase_expiry` | date DEFAULT NULL |
| `version` | int DEFAULT '1' |
| `remark` | text COLLATE utf8mb3_unicode_ci |
| `created_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP |

## Table: `cloud_audit_logs`
| Column | Definition |
| :--- | :--- |
| `id` | varchar(36) COLLATE utf8mb3_unicode_ci NOT NULL |
| `user_id` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `user_name` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `action` | varchar(20) COLLATE utf8mb3_unicode_ci NOT NULL |
| `resource` | varchar(100) COLLATE utf8mb3_unicode_ci NOT NULL |
| `resource_id` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `details` | text COLLATE utf8mb3_unicode_ci |
| `ip_address` | varchar(45) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `user_agent` | text COLLATE utf8mb3_unicode_ci |
| `created_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP |

## Table: `cloud_mappings`
| Column | Definition |
| :--- | :--- |
| `id` | varchar(20) COLLATE utf8mb3_unicode_ci NOT NULL |
| `server_id` | varchar(20) COLLATE utf8mb3_unicode_ci NOT NULL |
| `customer_id` | int NOT NULL |
| `serial_no` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `billed_users` | int DEFAULT '0' |
| `purchase_users` | int DEFAULT '0' |
| `status` | enum('Active','Inactive') COLLATE utf8mb3_unicode_ci DEFAULT 'Active' |
| `mapped_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP |
| `billing_cycle` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `billing_mode` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `billing_rate` | decimal(10,2) DEFAULT '0.00' |
| `purchase_rate` | decimal(10,2) DEFAULT '0.00' |
| `expiry_date` | date DEFAULT NULL |
| `purchased_users` | int DEFAULT '0' |
| `effective_cycle` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `effective_mode` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `effective_rate` | decimal(10,2) DEFAULT '0.00' |
| `effective_expiry` | date DEFAULT NULL |

## Table: `cloud_pincodes`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `pincode` | varchar(10) COLLATE utf8mb3_unicode_ci NOT NULL |
| `city` | varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL |
| `state` | varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL |

## Table: `cloud_servers`
| Column | Definition |
| :--- | :--- |
| `id` | varchar(20) COLLATE utf8mb3_unicode_ci NOT NULL |
| `server_ip` | varchar(100) COLLATE utf8mb3_unicode_ci NOT NULL |
| `sof_no` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `port` | varchar(10) COLLATE utf8mb3_unicode_ci NOT NULL |
| `customer_ip` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `admin_username` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `admin_password_enc` | varchar(500) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `status` | enum('Active','Inactive','Maintenance') COLLATE utf8mb3_unicode_ci DEFAULT 'Active' |
| `company` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `purchase_rate` | decimal(10,2) DEFAULT NULL |
| `purchase_units` | int DEFAULT '0' |
| `billing_mode` | enum('day_to_day','month_to_month') COLLATE utf8mb3_unicode_ci DEFAULT 'day_to_day' |
| `billing_cycle` | enum('Monthly','Quarterly','Half-Yearly','Yearly') COLLATE utf8mb3_unicode_ci DEFAULT 'Yearly' |
| `server_expiry` | date DEFAULT NULL |
| `created_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `cloud_tdl_master`
| Column | Definition |
| :--- | :--- |
| `id` | varchar(50) COLLATE utf8mb3_unicode_ci NOT NULL |
| `customer_id` | int DEFAULT NULL |
| `customer_name` | varchar(150) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `request_type` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `priority` | enum('Low','Medium','High','Urgent') COLLATE utf8mb3_unicode_ci DEFAULT 'Medium' |
| `status` | enum('Pending','In Progress','Completed','Cancelled','Quotation','Implementation','Advance Pending') COLLATE utf8mb3_unicode_ci DEFAULT 'Pending' |
| `description` | text COLLATE utf8mb3_unicode_ci |
| `api_token` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `total_amount` | decimal(12,2) DEFAULT '0.00' |
| `created_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |
| `handled_by` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `project_name` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `tally_serial_no` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `amc_required` | tinyint(1) DEFAULT '0' |
| `expiry_date` | date DEFAULT NULL |
| `phone_no` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `person_name` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |

## Table: `cloud_tdl_requirements`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `tdl_id` | varchar(50) COLLATE utf8mb3_unicode_ci NOT NULL |
| `requirement` | text COLLATE utf8mb3_unicode_ci |
| `amount` | decimal(10,2) DEFAULT '0.00' |
| `attachment` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `development_days` | int DEFAULT '0' |
| `dev_status` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT 'Pending' |
| `dev_allotment_date` | date DEFAULT NULL |
| `req_status` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT 'Pending' |

## Table: `cloud_tdl_tasks`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `req_id` | int DEFAULT NULL |
| `user_name` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `task_type` | enum('Development','Implementation','Connect') COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'Development' |
| `allotment_date` | date DEFAULT NULL |
| `deadline` | date DEFAULT NULL |
| `completion_date` | date DEFAULT NULL |
| `check_in_date` | date DEFAULT NULL |
| `check_in_time` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_in_lat` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_in_lng` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_out_time` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_out_lat` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_out_lng` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `status` | enum('Pending','Completed','In Progress') COLLATE utf8mb3_unicode_ci DEFAULT 'Pending' |
| `remark` | text COLLATE utf8mb3_unicode_ci |
| `assigned_by` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `tdl_id` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_out_response` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `loyalty` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `conversion_probability` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `customer_behaviour` | text COLLATE utf8mb3_unicode_ci |
| `e_invoice` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `business_type` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `accounts_person_type` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `it_person` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `ca_name` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `business_description` | text COLLATE utf8mb3_unicode_ci |
| `e_way_bill` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `connected_banking` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `whatsapp_enabled` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `customisation` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `tally_slow` | varchar(20) COLLATE utf8mb3_unicode_ci DEFAULT NULL |

## Table: `cloud_tdl_task_history`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `task_id` | int NOT NULL |
| `changed_by` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `change_type` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `old_value` | text COLLATE utf8mb3_unicode_ci |
| `new_value` | text COLLATE utf8mb3_unicode_ci |
| `description` | text COLLATE utf8mb3_unicode_ci |
| `created_at` | datetime DEFAULT CURRENT_TIMESTAMP |

## Table: `cloud_users`
| Column | Definition |
| :--- | :--- |
| `id` | varchar(20) COLLATE utf8mb3_unicode_ci NOT NULL |
| `name` | varchar(100) COLLATE utf8mb3_unicode_ci NOT NULL |
| `email` | varchar(100) COLLATE utf8mb3_unicode_ci NOT NULL |
| `password_hash` | varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL |
| `role` | enum('admin','user') COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'user' |
| `status` | enum('active','inactive') COLLATE utf8mb3_unicode_ci DEFAULT 'active' |
| `permissions` | json NOT NULL |
| `two_fa_secret` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `is_two_fa_enabled` | tinyint(1) DEFAULT '0' |
| `created_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |
| `tag` | enum('Inside','Outside') COLLATE utf8mb3_unicode_ci DEFAULT 'Inside' |
| `last_location` | json DEFAULT NULL |
| `last_location_at` | timestamp NULL DEFAULT NULL |
| `column_permissions` | text COLLATE utf8mb3_unicode_ci |

## Table: `cloud_user_sessions`
| Column | Definition |
| :--- | :--- |
| `user_id` | varchar(20) COLLATE utf8mb3_unicode_ci NOT NULL |
| `email` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `login_time` | timestamp NULL DEFAULT CURRENT_TIMESTAMP |
| `last_active` | timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `cloud_visits`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `customer_id` | int NOT NULL |
| `user_name` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `assigned_by` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `visit_type` | enum('Visit','Call') COLLATE utf8mb3_unicode_ci NOT NULL |
| `status` | enum('Pending','Completed','Paused','Cancelled','In Progress') COLLATE utf8mb3_unicode_ci DEFAULT 'Pending' |
| `scheduled_date` | date DEFAULT NULL |
| `check_in_time` | datetime DEFAULT NULL |
| `check_in_lat` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_in_lng` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_out_time` | datetime DEFAULT NULL |
| `check_out_lat` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_out_lng` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_out_remark` | text COLLATE utf8mb3_unicode_ci |
| `created_at` | datetime DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |
| `e_invoice` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `business_type` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `accounts_person_type` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `it_person` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `ca_name` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `business_description` | text COLLATE utf8mb3_unicode_ci |
| `e_way_bill` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `connected_banking` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `whatsapp_enabled` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `customisation` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `tally_slow` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `loyalty` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `conversion_probability` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `check_out_response` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `customer_behaviour` | text COLLATE utf8mb3_unicode_ci |
| `force_checkin_allowed` | tinyint(1) DEFAULT '0' |
| `phone_no` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |

## Table: `custom`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `company` | int NOT NULL |
| `personid` | int NOT NULL |
| `handleby` | int NOT NULL |
| `status` | int NOT NULL |
| `next_date` | date NOT NULL |
| `amount` | int NOT NULL |
| `remark` | varchar(255) NOT NULL |
| `date` | date NOT NULL |
| `addedby` | int NOT NULL |
| `last_update` | datetime NOT NULL |
| `customid` | int NOT NULL |

## Table: `customer`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `company` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `group` | int DEFAULT '3' |
| `cloud_group_id` | varchar(20) DEFAULT NULL |
| `group2` | varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `reason` | varchar(255) DEFAULT NULL |
| `partner` | varchar(255) DEFAULT NULL |
| `btype` | int DEFAULT '55' |
| `grade` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'Good' |
| `address1` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `address2` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `address3` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `pincode` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `state` | int DEFAULT NULL |
| `area` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `city` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `gstin` | varchar(255) DEFAULT NULL |
| `person` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `designation` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT '53' |
| `email` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `mobile` | varchar(255) DEFAULT NULL |
| `image` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `customerid` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `tempid` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `remarks` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `status` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `date` | date DEFAULT '2021-09-01' |
| `tally` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'No' |
| `broadcastid` | int DEFAULT '0' |
| `whatsapp` | varchar(10) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT 'Yes' |
| `lastvisitid` | int DEFAULT NULL |
| `lastvisitperson` | varchar(50) DEFAULT NULL |
| `lastvisitdate` | date DEFAULT NULL |
| `lastvisitremark` | text CHARACTER SET latin1 COLLATE latin1_swedish_ci |
| `lastcallid` | int DEFAULT NULL |
| `lastcallperson` | varchar(50) DEFAULT NULL |
| `lastcalldate` | date DEFAULT NULL |
| `lastcallremark` | text CHARACTER SET latin1 COLLATE latin1_swedish_ci |
| `lastcallstatus` | text CHARACTER SET latin1 COLLATE latin1_swedish_ci |
| `lastcalluserid` | int DEFAULT NULL |
| `lattitude` | varchar(100) DEFAULT NULL |
| `longitude` | varchar(100) DEFAULT NULL |
| `resellerid` | int DEFAULT NULL |
| `mappingid` | int DEFAULT NULL |
| `e_invoice` | varchar(20) DEFAULT NULL |
| `business_type` | varchar(100) DEFAULT NULL |
| `accounts_person_type` | varchar(100) DEFAULT NULL |
| `it_person` | varchar(255) DEFAULT NULL |
| `ca_name` | varchar(255) DEFAULT NULL |
| `business_description` | text |
| `e_way_bill` | varchar(20) DEFAULT NULL |
| `connected_banking` | varchar(20) DEFAULT NULL |
| `whatsapp_enabled` | varchar(20) DEFAULT NULL |
| `customisation` | varchar(20) DEFAULT NULL |
| `tally_slow` | varchar(20) DEFAULT NULL |
| `loyalty` | varchar(50) DEFAULT NULL |
| `conversion_probability` | varchar(50) DEFAULT NULL |
| `customer_behaviour` | text |

## Table: `customerupdate`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `customerid` | varchar(11) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `type` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `add_by` | varchar(11) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `add_date` | date DEFAULT NULL |
| `approve_by` | varchar(11) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `approve_date` | date DEFAULT NULL |
| `status` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |

## Table: `customer_contact_details`
| Column | Definition |
| :--- | :--- |
| `id` | bigint NOT NULL |
| `contact_person` | varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `mobile_no` | varchar(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `old_id` | bigint NOT NULL DEFAULT '0' |
| `status` | enum('Active','Inactive') CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'Active' |
| `created_by` | bigint NOT NULL DEFAULT '1' |
| `created_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP |
| `updated_by` | bigint NOT NULL DEFAULT '0' |
| `updated_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `customer_contact_mapping_data`
| Column | Definition |
| :--- | :--- |
| `id` | bigint NOT NULL |
| `customer_id` | bigint NOT NULL |
| `mobile_id` | bigint NOT NULL |
| `status` | enum('Active','Inactive') CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'Active' |
| `inactive_date` | date DEFAULT NULL |
| `primary_contact` | enum('Yes','No') CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'No' |
| `created_by` | bigint NOT NULL DEFAULT '1' |
| `created_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP |
| `updated_by` | bigint NOT NULL DEFAULT '0' |
| `updated_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `entry`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `customerid` | int NOT NULL |
| `type` | varchar(255) DEFAULT NULL |
| `entrytype` | varchar(255) DEFAULT NULL |
| `start_time` | timestamp NULL DEFAULT NULL |
| `end_time` | timestamp NULL DEFAULT NULL |
| `personid` | varchar(255) DEFAULT NULL |
| `status` | varchar(255) DEFAULT NULL |
| `next_date` | date DEFAULT NULL |
| `product_type` | varchar(255) DEFAULT NULL |
| `remark` | varchar(255) DEFAULT NULL |
| `cremark` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `entrydate` | timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP |
| `date` | date DEFAULT NULL |
| `addedby` | int NOT NULL DEFAULT '1' |
| `completedby` | int DEFAULT NULL |
| `cdate` | date DEFAULT NULL |
| `lattitude` | varchar(100) DEFAULT NULL |
| `longitude` | varchar(100) DEFAULT NULL |

## Table: `expensecommission`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `type` | varchar(255) NOT NULL |
| `expenseid` | int NOT NULL |
| `billingitemid` | int NOT NULL |
| `amount` | int NOT NULL |
| `remarks` | text NOT NULL |

## Table: `expensepayment`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `billingcompany` | int NOT NULL |
| `entrytype` | varchar(255) NOT NULL |
| `expensegroup` | int NOT NULL |
| `expensetype` | int NOT NULL |
| `expenseledger` | int NOT NULL |
| `paymentledger` | int NOT NULL |
| `c_user` | int NOT NULL |
| `bill_item` | text NOT NULL |
| `amount_row` | text NOT NULL |
| `amount` | int NOT NULL |
| `payment_type` | varchar(255) NOT NULL |
| `instrument` | varchar(255) NOT NULL |
| `bank_date` | date NOT NULL |
| `date` | date NOT NULL |
| `remarks` | varchar(255) NOT NULL |
| `addedby` | int NOT NULL |
| `tally` | varchar(20) NOT NULL DEFAULT 'No' |
| `status` | varchar(255) NOT NULL DEFAULT 'Pending' |
| `masterID` | varchar(255) NOT NULL |
| `voucher_no` | varchar(255) NOT NULL |
| `voucher_date` | date NOT NULL |

## Table: `group_change_history`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `customer_id` | int NOT NULL |
| `old_group` | int NOT NULL |
| `new_group` | int NOT NULL |
| `add_by` | int NOT NULL |
| `date` | date NOT NULL |

## Table: `history`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `type` | varchar(255) NOT NULL |
| `typeid` | int NOT NULL |
| `action` | varchar(255) NOT NULL |
| `remarks` | text NOT NULL |
| `added_by` | int NOT NULL |
| `date_added` | date NOT NULL |
| `next_date` | date NOT NULL |

## Table: `office_check_in_out_details`
| Column | Definition |
| :--- | :--- |
| `id` | bigint NOT NULL |
| `office_name` | varchar(500) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `office_address` | text CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `latitude` | varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `longitude` | varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `radious` | int NOT NULL |
| `working_hours` | time NOT NULL |
| `status` | enum('Active','Inactive') CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'Active' |
| `created_by` | bigint NOT NULL DEFAULT '0' |
| `created_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP |
| `updated_by` | bigint NOT NULL DEFAULT '0' |
| `updated_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `office_check_in_out_details_new`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `office_name` | varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL |
| `latitude` | decimal(10,8) NOT NULL |
| `longitude` | decimal(11,8) NOT NULL |
| `radius` | int DEFAULT '100' |
| `created_at` | timestamp NULL DEFAULT CURRENT_TIMESTAMP |

## Table: `OldTallyDataBills`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `BillNo` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `BillDate` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `PartyName` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `PartyGroup` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `Address1` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `Address2` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `Address3` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `LedState` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `LedContact` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `LedPhone` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `LedEmail` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `LEdGSTIN` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `PrdouctName` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `SerialNo` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `BillQty` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |
| `BilRate` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL |

## Table: `payment`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `billingid` | int DEFAULT NULL |
| `entrytype` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `next_type` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `next_date` | date DEFAULT NULL |
| `remark` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `payment` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `instrument` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `amount` | float DEFAULT NULL |
| `tds` | int DEFAULT NULL |
| `bank` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `paymentledger` | int NOT NULL DEFAULT '308' |
| `date` | date DEFAULT NULL |
| `addby` | int DEFAULT NULL |
| `approve` | varchar(20) NOT NULL DEFAULT 'No' |
| `tally` | varchar(20) NOT NULL DEFAULT 'No' |
| `status` | varchar(20) NOT NULL DEFAULT 'Approved' |
| `complete` | varchar(20) NOT NULL DEFAULT 'No' |
| `masterID` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `voucher_no` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `voucher_date` | date DEFAULT NULL |
| `bank_date` | date DEFAULT NULL |

## Table: `pincode`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `city` | varchar(255) NOT NULL |
| `pincode` | varchar(255) NOT NULL |
| `stateid` | int NOT NULL |

## Table: `product`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `name` | varchar(255) NOT NULL |
| `tallyflavor` | int NOT NULL |
| `serial` | varchar(255) NOT NULL |
| `expiry_option` | varchar(20) NOT NULL DEFAULT 'No' |
| `cost` | varchar(255) NOT NULL |
| `gstrate` | int NOT NULL |
| `hsn` | varchar(255) NOT NULL |
| `qty` | int NOT NULL |
| `date` | date NOT NULL |

## Table: `reseller`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `name` | varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `mobile` | text CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `email` | text CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `pan` | text CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `address` | text CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `date` | text CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |

## Table: `servicecall`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `customerid` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `createdby` | varchar(255) NOT NULL |
| `tallyid` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `issue` | varchar(255) NOT NULL |
| `product_type` | varchar(255) NOT NULL DEFAULT 'Tally' |
| `service_type` | enum('service','lead') NOT NULL DEFAULT 'service' |
| `status` | varchar(255) NOT NULL |
| `addedby` | int NOT NULL DEFAULT '1' |
| `handleby` | int NOT NULL |
| `date` | date DEFAULT NULL |
| `time` | time DEFAULT NULL |
| `next_date` | date DEFAULT NULL |
| `completedby` | int DEFAULT NULL |
| `cdate` | date NOT NULL |
| `ctime` | time NOT NULL |
| `task` | varchar(20) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL DEFAULT 'No' |
| `mobile_no` | varchar(255) NOT NULL DEFAULT '' |
| `next_followup_date_time` | datetime DEFAULT NULL |
| `recal_remark` | text |
| `alloted_date_time` | datetime DEFAULT NULL |

## Table: `service_calls`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `mobile_no` | varchar(15) COLLATE utf8mb3_unicode_ci NOT NULL |
| `contact_person` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `service_type` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `remark` | text COLLATE utf8mb3_unicode_ci |
| `serial_number` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `expire_date` | date DEFAULT NULL |
| `flavor` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `status` | enum('Open','In Progress','Closed','Cancelled') COLLATE utf8mb3_unicode_ci DEFAULT 'Open' |
| `customer_id` | int DEFAULT NULL |
| `taken_by` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `taken_at` | datetime DEFAULT NULL |
| `transferred_by` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `transferred_at` | datetime DEFAULT NULL |
| `resolution_note` | text COLLATE utf8mb3_unicode_ci |
| `closed_at` | datetime DEFAULT NULL |
| `created_by` | varchar(100) COLLATE utf8mb3_unicode_ci NOT NULL |
| `created_at` | datetime DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `singlemaster`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `name` | varchar(255) NOT NULL |
| `type` | varchar(255) NOT NULL |

## Table: `state`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `name` | varchar(255) NOT NULL |

## Table: `tallydetails`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `tallyserial` | varchar(255) NOT NULL |
| `tallyexpirydate` | date NOT NULL |
| `tally_status` | varchar(255) NOT NULL DEFAULT 'Our Tally' |
| `active_status` | varchar(255) NOT NULL DEFAULT 'Active' |
| `inactive_date` | date DEFAULT NULL |
| `expiry_status` | varchar(255) NOT NULL DEFAULT '184' |
| `tallyflavor` | varchar(255) NOT NULL DEFAULT '56' |
| `tallyrelease` | varchar(255) DEFAULT NULL |
| `reneval` | varchar(255) NOT NULL DEFAULT 'New Release' |
| `customerid` | varchar(255) NOT NULL |
| `tempid` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `next_date` | date DEFAULT NULL |
| `remark` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `addedby` | int DEFAULT NULL |
| `add_date` | date NOT NULL DEFAULT '2022-01-01' |
| `active_date` | date DEFAULT NULL |
| `left_date` | date DEFAULT NULL |
| `partner` | varchar(255) NOT NULL DEFAULT 'ABS Technologies' |
| `partner_new` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `reason` | varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL |
| `cron_date` | date DEFAULT NULL |
| `mau` | enum('Yes','No') NOT NULL DEFAULT 'No' |
| `qau` | enum('Yes','No') NOT NULL DEFAULT 'No' |

## Table: `task`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `company` | int NOT NULL |
| `type` | varchar(255) NOT NULL |
| `typeid` | int NOT NULL |
| `subtype` | varchar(255) NOT NULL |
| `remarks` | text NOT NULL |
| `status` | varchar(255) NOT NULL |
| `date_added` | date NOT NULL |
| `added_by` | int NOT NULL |
| `next_date` | date NOT NULL |

## Table: `tdldetails`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `tdlserial` | varchar(255) NOT NULL |
| `tdlname` | varchar(255) NOT NULL |
| `tdlexpiry` | date NOT NULL |
| `cycle` | varchar(255) NOT NULL |
| `amount` | varchar(255) NOT NULL |
| `status` | varchar(255) NOT NULL |
| `customerid` | varchar(255) NOT NULL |
| `tempid` | varchar(255) NOT NULL |

## Table: `tdl_master`
| Column | Definition |
| :--- | :--- |
| `id` | varchar(50) COLLATE utf8mb3_unicode_ci NOT NULL |
| `customer_id` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `tally_serial_no` | varchar(100) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `person_name` | varchar(255) COLLATE utf8mb3_unicode_ci NOT NULL |
| `phone_no` | varchar(50) COLLATE utf8mb3_unicode_ci NOT NULL |
| `remark` | text COLLATE utf8mb3_unicode_ci |
| `handled_by` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `status` | varchar(50) COLLATE utf8mb3_unicode_ci DEFAULT 'Pending' |
| `amc_required` | tinyint(1) DEFAULT '0' |
| `project_name` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `expiry_date` | date DEFAULT NULL |
| `api_token` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `created_at` | datetime DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `tdl_requirements`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `tdl_id` | varchar(50) COLLATE utf8mb3_unicode_ci NOT NULL |
| `requirement` | text COLLATE utf8mb3_unicode_ci NOT NULL |
| `amount` | decimal(10,2) DEFAULT '0.00' |
| `attachment` | varchar(255) COLLATE utf8mb3_unicode_ci DEFAULT NULL |

## Table: `usercheck`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `userid` | int NOT NULL |
| `action` | varchar(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `date` | date NOT NULL |
| `time` | time NOT NULL |

## Table: `userproductmap`
| Column | Definition |
| :--- | :--- |
| `id` | int NOT NULL |
| `userid` | int NOT NULL |
| `productid` | int NOT NULL |
| `type` | varchar(255) NOT NULL |
| `amount` | int NOT NULL |

## Table: `user_checkin_checkout_details`
| Column | Definition |
| :--- | :--- |
| `id` | bigint NOT NULL |
| `user_id` | bigint NOT NULL |
| `date` | date NOT NULL |
| `checkin_time` | time DEFAULT NULL |
| `checkin_latitued` | varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `checkin_longitued` | varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `ckeckin_address_id` | bigint NOT NULL |
| `checkout_time` | time DEFAULT NULL |
| `checkout_latitude` | varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `checkout_longitude` | varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci DEFAULT NULL |
| `checkout_address_id` | bigint DEFAULT NULL |
| `working_hours` | time DEFAULT NULL |
| `in_out_status` | enum('Present','Absent','Pending') CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'Pending' |
| `status` | enum('Active','Inactive') CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'Active' |
| `created_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `user_checkin_checkout_details_new`
| Column | Definition |
| :--- | :--- |
| `id` | bigint NOT NULL |
| `user_id` | varchar(50) COLLATE utf8mb3_unicode_ci NOT NULL |
| `date` | date NOT NULL |
| `checkin_time` | time DEFAULT NULL |
| `checkin_latitude` | decimal(10,8) DEFAULT NULL |
| `checkin_longitude` | decimal(11,8) DEFAULT NULL |
| `checkin_address` | text COLLATE utf8mb3_unicode_ci |
| `checkout_time` | time DEFAULT NULL |
| `checkout_latitude` | decimal(10,8) DEFAULT NULL |
| `checkout_longitude` | decimal(11,8) DEFAULT NULL |
| `checkout_address` | text COLLATE utf8mb3_unicode_ci |
| `working_hours` | time DEFAULT NULL |
| `status` | enum('Present','Absent','Pending') COLLATE utf8mb3_unicode_ci DEFAULT 'Pending' |
| `created_at` | datetime DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `user_locations`
| Column | Definition |
| :--- | :--- |
| `id` | bigint NOT NULL |
| `user_id` | bigint NOT NULL |
| `latitude` | varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `longitude` | varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL |
| `status` | enum('Active','Inactive') CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_ci NOT NULL DEFAULT 'Active' |
| `created_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP |

## Table: `user_location_history`
| Column | Definition |
| :--- | :--- |
| `id` | bigint NOT NULL |
| `user_id` | varchar(50) COLLATE utf8mb3_unicode_ci NOT NULL |
| `latitude` | decimal(10,8) NOT NULL |
| `longitude` | decimal(11,8) NOT NULL |
| `recorded_at` | datetime DEFAULT CURRENT_TIMESTAMP |

