#!/bin/bash
sed -i 's|<script type="module">|<script type="module" src="admin-world.js"></script>\n    <script type="module">|' www/maintenance/admin.html
